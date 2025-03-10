const TABLE_NAME = '_nango_sync_jobs';

exports.up = function (knex, _) {
    return knex.schema.withSchema('nango').alterTable(TABLE_NAME, function (table) {
        table.integer('activity_log_id').references('id').inTable('nango._nango_activity_logs').onDelete('SET NULL');
    });
};

exports.down = function (knex, _) {
    return knex.schema.withSchema('nango').alterTable(TABLE_NAME, function (table) {
        table.dropColumn('activity_log_id');
    });
};
