// Database wrapper - supports both sqlite3 and better-sqlite3
let db;
let isBetterSqlite = false;

try {
    // Try sqlite3 first
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, 'water_monitoring.db');
    
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('❌ Lỗi kết nối database:', err.message);
            console.error('💡 Thử sử dụng better-sqlite3...');
            tryBetterSqlite();
        } else {
            console.log('✅ Đã kết nối tới SQLite database (sqlite3):', dbPath);
            isBetterSqlite = false;
        }
    });
} catch (error) {
    console.error('❌ sqlite3 không khả dụng:', error.message);
    console.log('💡 Chuyển sang better-sqlite3...');
    tryBetterSqlite();
}

function tryBetterSqlite() {
    try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(__dirname, 'water_monitoring.db');
        
        db = new Database(dbPath);
        isBetterSqlite = true;
        console.log('✅ Đã kết nối tới SQLite database (better-sqlite3):', dbPath);
        
        // Wrap better-sqlite3 to match sqlite3 API
        wrapBetterSqlite(db);
    } catch (err) {
        console.error('❌ Không thể kết nối database:', err.message);
        process.exit(1);
    }
}

function wrapBetterSqlite(database) {
    // Add sqlite3-compatible methods
    if (!database.serialize) {
        database.serialize = (callback) => callback();
    }
    
    if (!database.run) {
        const exec = database.exec.bind(database);
        database.run = (sql, params, callback) => {
            try {
                const result = database.prepare(sql).run(params || []);
                if (callback) callback(null);
                return result;
            } catch (err) {
                if (callback) callback(err);
            }
        };
    }
    
    if (!database.all) {
        database.all = (sql, params, callback) => {
            try {
                const stmt = database.prepare(sql);
                const rows = params ? stmt.all(params) : stmt.all();
                if (callback) callback(null, rows);
                return rows;
            } catch (err) {
                if (callback) callback(err, null);
            }
        };
    }
    
    if (!database.get) {
        database.get = (sql, params, callback) => {
            try {
                const stmt = database.prepare(sql);
                const row = params ? stmt.get(params) : stmt.get();
                if (callback) callback(null, row);
                return row;
            } catch (err) {
                if (callback) callback(err, null);
            }
        };
    }
}

module.exports = { db, isBetterSqlite };
