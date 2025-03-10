import parseLinksHeader from 'parse-link-header';
import get from 'lodash-es/get.js';
import type { Pagination, AxiosResponse, ProxyConfiguration, CursorPagination, OffsetPagination, LinkPagination } from '../sdk/sync.js';
import { PaginationType } from '../sdk/sync.js';
import { isValidHttpUrl } from '../utils/utils.js';

class PaginationService {
    public validateConfiguration(paginationConfig: Pagination): void {
        if (!paginationConfig.type) {
            throw new Error('Pagination type is required');
        }
        const { type } = paginationConfig;
        if (type.toLowerCase() === PaginationType.CURSOR) {
            const cursorPagination: CursorPagination = paginationConfig as CursorPagination;
            if (!cursorPagination.cursor_name_in_request) {
                throw new Error('Param cursor_name_in_request is required for cursor pagination');
            }
            if (!cursorPagination.cursor_path_in_response) {
                throw new Error('Param cursor_path_in_response is required for cursor pagination');
            }

            if (paginationConfig.limit && !paginationConfig.limit_name_in_request) {
                throw new Error('Param limit_name_in_request is required for cursor pagination when limit is set');
            }
        } else if (type.toLowerCase() === PaginationType.LINK) {
            const linkPagination: LinkPagination = paginationConfig as LinkPagination;
            if (!linkPagination.link_rel_in_response_header && !linkPagination.link_path_in_response_body) {
                throw new Error('Either param link_rel_in_response_header or link_path_in_response_body is required for link pagination');
            }
        } else if (type.toLowerCase() === PaginationType.OFFSET) {
            const offsetPagination: OffsetPagination = paginationConfig as OffsetPagination;
            if (!offsetPagination.offset_name_in_request) {
                throw new Error('Param offset_name_in_request is required for offset pagination');
            }
        } else {
            throw new Error(
                `Pagination type ${type} is not supported. Only ${PaginationType.CURSOR}, ${PaginationType.LINK}, and ${PaginationType.OFFSET} pagination types are supported.`
            );
        }
    }

    public async *cursor<T>(
        config: ProxyConfiguration,
        paginationConfig: CursorPagination,
        updatedBodyOrParams: Record<string, any>,
        passPaginationParamsInBody: boolean,
        proxy: (config: ProxyConfiguration) => Promise<AxiosResponse>
    ): AsyncGenerator<T[], undefined, void> {
        const cursorPagination: CursorPagination = paginationConfig as CursorPagination;

        let nextCursor: string | undefined;

        while (true) {
            if (nextCursor) {
                updatedBodyOrParams[cursorPagination.cursor_name_in_request] = nextCursor;
            }

            this.updateConfigBodyOrParams(passPaginationParamsInBody, config, updatedBodyOrParams);

            const response: AxiosResponse = await proxy(config);

            const responseData: T[] = cursorPagination.response_path ? get(response.data, cursorPagination.response_path) : response.data;

            if (!responseData.length) {
                return;
            }

            yield responseData;

            nextCursor = get(response.data, cursorPagination.cursor_path_in_response);

            if (!nextCursor || nextCursor.trim().length === 0) {
                return;
            }
        }
    }

    public async *link<T>(
        config: ProxyConfiguration,
        paginationConfig: LinkPagination,
        updatedBodyOrParams: Record<string, any>,
        passPaginationParamsInBody: boolean,
        proxy: (config: ProxyConfiguration) => Promise<AxiosResponse>
    ): AsyncGenerator<T[], undefined, void> {
        const linkPagination: LinkPagination = paginationConfig as LinkPagination;

        this.updateConfigBodyOrParams(passPaginationParamsInBody, config, updatedBodyOrParams);

        while (true) {
            const response: AxiosResponse = await proxy(config);

            const responseData: T[] = paginationConfig.response_path ? get(response.data, paginationConfig.response_path) : response.data;
            if (!responseData.length) {
                return;
            }

            yield responseData;

            const nextPageLink: string | undefined = this.getNextPageLinkFromBodyOrHeaders(linkPagination, response, paginationConfig);

            if (!nextPageLink) {
                return;
            }

            if (!isValidHttpUrl(nextPageLink)) {
                // some providers only send path+query params in the link so we can immediately assign those to the endpoint
                config.endpoint = nextPageLink;
            } else {
                const url: URL = new URL(nextPageLink);
                config.endpoint = url.pathname + url.search;
            }
            delete config.params;
        }
    }

    public async *offset<T>(
        config: ProxyConfiguration,
        paginationConfig: OffsetPagination,
        updatedBodyOrParams: Record<string, any>,
        passPaginationParamsInBody: boolean,
        proxy: (config: ProxyConfiguration) => Promise<AxiosResponse>
    ): AsyncGenerator<T[], undefined, void> {
        const offsetPagination: OffsetPagination = paginationConfig as OffsetPagination;
        const offsetParameterName: string = offsetPagination.offset_name_in_request;
        let offset = 0;

        while (true) {
            updatedBodyOrParams[offsetParameterName] = `${offset}`;

            this.updateConfigBodyOrParams(passPaginationParamsInBody, config, updatedBodyOrParams);

            const response: AxiosResponse = await proxy(config);

            const responseData: T[] = paginationConfig.response_path ? get(response.data, paginationConfig.response_path) : response.data;
            if (!responseData || !responseData.length) {
                return;
            }

            yield responseData;

            if (paginationConfig['limit'] && responseData.length < paginationConfig['limit']) {
                return;
            }

            if (responseData.length < 1) {
                // Last page was empty so no need to fetch further
                return;
            }

            offset += responseData.length;
        }
    }

    private updateConfigBodyOrParams(passPaginationParamsInBody: boolean, config: ProxyConfiguration, updatedBodyOrParams: Record<string, string>) {
        passPaginationParamsInBody ? (config.data = updatedBodyOrParams) : (config.params = updatedBodyOrParams);
    }

    private getNextPageLinkFromBodyOrHeaders(linkPagination: LinkPagination, response: AxiosResponse<any, any>, paginationConfig: Pagination) {
        if (linkPagination.link_rel_in_response_header) {
            const linkHeader = parseLinksHeader(response.headers['link']);
            return linkHeader?.[linkPagination.link_rel_in_response_header]?.url;
        } else if (linkPagination.link_path_in_response_body) {
            return get(response.data, linkPagination.link_path_in_response_body);
        }

        throw Error(`Either 'link_rel_in_response_header' or 'link_path_in_response_body' should be specified for '${paginationConfig.type}' pagination`);
    }
}

export default new PaginationService();
