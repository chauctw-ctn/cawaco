// Database wrapper - PostgreSQL với pg client
// File này giờ chỉ đơn giản export từ database.js để tương thích với code cũ

const database = require('./database');

// Export tất cả từ database.js
module.exports = database;

// Legacy support
module.exports.db = database.pool;
module.exports.isBetterSqlite = false;
module.exports.isPostgreSQL = true;
