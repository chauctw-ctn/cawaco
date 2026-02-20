/**
 * Database Optimization and Maintenance Script
 * Script để tối ưu hóa và bảo trì PostgreSQL database
 * 
 * Chức năng:
 * - Phân tích và tối ưu indexes
 * - VACUUM và ANALYZE tables
 * - Kiểm tra và báo cáo hiệu suất
 * - Xóa dữ liệu cũ
 * - Rebuild indexes nếu cần
 */

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl,
    options: config.database.options
});

/**
 * Phân tích kích thước bảng
 */
async function analyzeTableSizes() {
    console.log('\n📊 ===== PHÂN TÍCH KÍCH THƯỚC BẢNG =====\n');
    
    const query = `
        SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
            pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes,
            n_tup_ins AS inserts,
            n_tup_upd AS updates,
            n_tup_del AS deletes,
            n_live_tup AS live_rows,
            n_dead_tup AS dead_rows,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY size_bytes DESC;
    `;
    
    const result = await pool.query(query);
    
    console.table(result.rows.map(row => ({
        'Table': row.tablename,
        'Size': row.size,
        'Live Rows': row.live_rows?.toLocaleString() || '0',
        'Dead Rows': row.dead_rows?.toLocaleString() || '0',
        'Last Analyze': row.last_autoanalyze || row.last_analyze || 'Never'
    })));
}

/**
 * Phân tích indexes
 */
async function analyzeIndexes() {
    console.log('\n📑 ===== PHÂN TÍCH INDEXES =====\n');
    
    const query = `
        SELECT 
            schemaname,
            tablename,
            indexname,
            pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
            idx_scan AS times_used,
            idx_tup_read AS tuples_read,
            idx_tup_fetch AS tuples_fetched
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
        ORDER BY pg_relation_size(indexrelid) DESC;
    `;
    
    const result = await pool.query(query);
    
    console.table(result.rows.map(row => ({
        'Table': row.tablename,
        'Index': row.indexname,
        'Size': row.index_size,
        'Times Used': row.times_used?.toLocaleString() || '0',
        'Tuples Read': row.tuples_read?.toLocaleString() || '0'
    })));
    
    // Tìm unused indexes
    const unusedIndexes = result.rows.filter(row => row.times_used === 0 || row.times_used === null);
    if (unusedIndexes.length > 0) {
        console.log('\n⚠️  UNUSED INDEXES (có thể xóa để tiết kiệm không gian):');
        unusedIndexes.forEach(idx => {
            console.log(`   - ${idx.indexname} on ${idx.tablename} (${idx.index_size})`);
        });
    }
}

/**
 * Chạy VACUUM ANALYZE trên tất cả các bảng
 */
async function vacuumAnalyzeTables() {
    console.log('\n🧹 ===== VACUUM ANALYZE =====\n');
    
    const tables = ['tva_data', 'mqtt_data', 'scada_data', 'stations', 'visitor_stats'];
    
    for (const table of tables) {
        try {
            console.log(`   Đang xử lý ${table}...`);
            await pool.query(`VACUUM ANALYZE ${table}`);
            console.log(`   ✅ ${table} - Hoàn thành`);
        } catch (err) {
            console.error(`   ❌ ${table} - Lỗi: ${err.message}`);
        }
    }
}

/**
 * Kiểm tra query performance
 */
async function checkQueryPerformance() {
    console.log('\n⚡ ===== KIỂM TRA HIỆU SUẤT QUERY =====\n');
    
    // Test query với EXPLAIN ANALYZE
    const testQueries = [
        {
            name: 'Latest station data (TVA)',
            query: `
                SELECT DISTINCT ON (station_name, parameter_name)
                    station_name, parameter_name, value, created_at
                FROM tva_data
                WHERE created_at > NOW() - INTERVAL '24 hours'
                ORDER BY station_name, parameter_name, created_at DESC
                LIMIT 100
            `
        },
        {
            name: 'Station status check',
            query: `
                SELECT DISTINCT ON (station_name)
                    station_name, created_at
                FROM mqtt_data
                WHERE created_at > NOW() - INTERVAL '65 minutes'
                ORDER BY station_name, created_at DESC
            `
        }
    ];
    
    for (const test of testQueries) {
        console.log(`\n📝 Testing: ${test.name}`);
        try {
            const start = Date.now();
            const result = await pool.query(`EXPLAIN ANALYZE ${test.query}`);
            const duration = Date.now() - start;
            
            console.log(`   ⏱️  Execution time: ${duration}ms`);
            
            // Hiển thị planning và execution time từ EXPLAIN ANALYZE
            const planResult = result.rows[result.rows.length - 1];
            if (planResult) {
                console.log(`   📊 ${planResult['QUERY PLAN']}`);
            }
        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        }
    }
}

/**
 * Xóa dữ liệu cũ
 */
async function cleanOldData(daysToKeep = 90) {
    console.log(`\n🗑️  ===== XÓA DỮ LIỆU CŨ HƠN ${daysToKeep} NGÀY =====\n`);
    
    const tables = ['tva_data', 'mqtt_data', 'scada_data'];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let totalDeleted = 0;
    
    for (const table of tables) {
        try {
            const result = await pool.query(
                `DELETE FROM ${table} WHERE created_at < $1`,
                [cutoffDate]
            );
            totalDeleted += result.rowCount;
            console.log(`   ✅ ${table}: Đã xóa ${result.rowCount.toLocaleString()} records`);
        } catch (err) {
            console.error(`   ❌ ${table}: ${err.message}`);
        }
    }
    
    console.log(`\n   📊 Tổng: Đã xóa ${totalDeleted.toLocaleString()} records`);
    return totalDeleted;
}

/**
 * Kiểm tra và cảnh báo về bloat
 */
async function checkTableBloat() {
    console.log('\n💾 ===== KIỂM TRA TABLE BLOAT =====\n');
    
    const query = `
        SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
            n_dead_tup AS dead_tuples,
            n_live_tup AS live_tuples,
            CASE 
                WHEN n_live_tup > 0 
                THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
                ELSE 0 
            END AS dead_ratio
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY n_dead_tup DESC;
    `;
    
    const result = await pool.query(query);
    
    console.table(result.rows.map(row => ({
        'Table': row.tablename,
        'Total Size': row.total_size,
        'Live Tuples': row.live_tuples?.toLocaleString() || '0',
        'Dead Tuples': row.dead_tuples?.toLocaleString() || '0',
        'Dead %': `${row.dead_ratio}%`
    })));
    
    // Cảnh báo nếu có table có > 20% dead tuples
    const bloatedTables = result.rows.filter(row => parseFloat(row.dead_ratio) > 20);
    if (bloatedTables.length > 0) {
        console.log('\n⚠️  CẢNH BÁO: Các bảng có nhiều dead tuples (nên chạy VACUUM):');
        bloatedTables.forEach(table => {
            console.log(`   - ${table.tablename}: ${table.dead_ratio}% dead tuples`);
        });
    }
}

/**
 * Tạo hoặc rebuild indexes
 */
async function rebuildIndexes(force = false) {
    console.log('\n🔧 ===== REBUILD INDEXES =====\n');
    
    const tables = [
        { table: 'tva_data', indexes: [
            'idx_tva_station_time',
            'idx_tva_param_time',
            'idx_tva_station_param_time',
            'idx_tva_time'
        ]},
        { table: 'mqtt_data', indexes: [
            'idx_mqtt_station_time',
            'idx_mqtt_param_time',
            'idx_mqtt_station_param_time',
            'idx_mqtt_time'
        ]},
        { table: 'scada_data', indexes: [
            'idx_scada_station_time',
            'idx_scada_param_time',
            'idx_scada_station_param_time',
            'idx_scada_time'
        ]}
    ];
    
    for (const tableInfo of tables) {
        console.log(`\n📋 ${tableInfo.table}:`);
        for (const indexName of tableInfo.indexes) {
            try {
                if (force) {
                    console.log(`   Rebuilding ${indexName}...`);
                    await pool.query(`REINDEX INDEX CONCURRENTLY ${indexName}`);
                    console.log(`   ✅ ${indexName} - Rebuilt`);
                } else {
                    console.log(`   ℹ️  ${indexName} - Exists (use --force to rebuild)`);
                }
            } catch (err) {
                console.error(`   ❌ ${indexName} - Error: ${err.message}`);
            }
        }
    }
}

/**
 * Test kết nối và hiệu suất cơ bản
 */
async function testConnection() {
    console.log('\n🔌 ===== KIỂM TRA KẾT NỐI =====\n');
    
    try {
        const start = Date.now();
        const result = await pool.query('SELECT NOW() as server_time, version() as pg_version');
        const duration = Date.now() - start;
        
        console.log(`   ✅ Kết nối thành công`);
        console.log(`   ⏱️  Latency: ${duration}ms`);
        console.log(`   🕐 Server time: ${result.rows[0].server_time}`);
        console.log(`   📦 PostgreSQL: ${result.rows[0].pg_version.split(',')[0]}`);
        
        // Kiểm tra pool status
        console.log(`\n   📊 Connection Pool:`);
        console.log(`      - Total connections: ${pool.totalCount}`);
        console.log(`      - Idle connections: ${pool.idleCount}`);
        console.log(`      - Waiting clients: ${pool.waitingCount}`);
    } catch (err) {
        console.error(`   ❌ Lỗi kết nối: ${err.message}`);
        throw err;
    }
}

/**
 * Main function
 */
async function main() {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log('║   DATABASE OPTIMIZATION & MAINTENANCE TOOL        ║');
    console.log('╚═══════════════════════════════════════════════════╝');
    
    const args = process.argv.slice(2);
    const command = args[0] || 'check';
    
    try {
        await testConnection();
        
        switch (command) {
            case 'check':
                console.log('\n🔍 Chế độ: CHECK - Kiểm tra và phân tích');
                await analyzeTableSizes();
                await analyzeIndexes();
                await checkTableBloat();
                await checkQueryPerformance();
                break;
                
            case 'optimize':
                console.log('\n⚡ Chế độ: OPTIMIZE - Tối ưu hóa database');
                await analyzeTableSizes();
                await checkTableBloat();
                await vacuumAnalyzeTables();
                await analyzeTableSizes(); // Show improvement
                break;
                
            case 'clean':
                const days = parseInt(args[1]) || 90;
                console.log(`\n🗑️  Chế độ: CLEAN - Xóa dữ liệu cũ hơn ${days} ngày`);
                await cleanOldData(days);
                await vacuumAnalyzeTables();
                break;
                
            case 'rebuild':
                console.log('\n🔧 Chế độ: REBUILD - Rebuild indexes');
                await rebuildIndexes(args.includes('--force'));
                break;
                
            case 'full':
                console.log('\n🚀 Chế độ: FULL - Bảo trì toàn diện');
                await analyzeTableSizes();
                await analyzeIndexes();
                await checkTableBloat();
                await vacuumAnalyzeTables();
                console.log('\n✅ Hoàn thành bảo trì toàn diện!');
                break;
                
            default:
                console.log('\n❌ Lệnh không hợp lệ!');
                console.log('\nCách sử dụng:');
                console.log('  node optimize-database.js check           - Kiểm tra và phân tích');
                console.log('  node optimize-database.js optimize        - Tối ưu hóa (VACUUM ANALYZE)');
                console.log('  node optimize-database.js clean [days]    - Xóa dữ liệu cũ (mặc định 90 ngày)');
                console.log('  node optimize-database.js rebuild [--force] - Rebuild indexes');
                console.log('  node optimize-database.js full            - Bảo trì toàn diện');
                break;
        }
        
        console.log('\n✅ Hoàn thành!');
    } catch (error) {
        console.error('\n❌ Lỗi:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Chạy script
if (require.main === module) {
    main().catch(console.error);
}

module.exports = {
    analyzeTableSizes,
    analyzeIndexes,
    vacuumAnalyzeTables,
    cleanOldData,
    checkTableBloat,
    rebuildIndexes,
    testConnection
};
