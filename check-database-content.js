/**
 * Script kiểm tra dữ liệu trong PostgreSQL
 */

const { Pool } = require('pg');
const config = require('./config');

async function checkDatabase() {
    const pool = new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl,
        max: 5
    });

    try {
        await pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        console.log('📊 KIỂM TRA DỮ LIỆU TRONG POSTGRESQL\n');
        
        const tables = ['tva_data', 'mqtt_data', 'scada_data'];
        
        for (const table of tables) {
            console.log(`\n${'='.repeat(70)}`);
            console.log(`📋 BẢNG: ${table.toUpperCase()}`);
            console.log('='.repeat(70));
            
            // Đếm tổng số records
            const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
            console.log(`Tổng số records: ${countResult.rows[0].count}`);
            
            // Danh sách trạm
            const stationsResult = await pool.query(`
                SELECT DISTINCT station_name 
                FROM ${table} 
                ORDER BY station_name
            `);
            console.log(`\nSố trạm: ${stationsResult.rows.length}`);
            if (stationsResult.rows.length > 0) {
                console.log('Danh sách trạm:');
                stationsResult.rows.forEach((row, idx) => {
                    console.log(`  ${idx + 1}. ${row.station_name}`);
                });
            }
            
            // Danh sách parameters
            const paramsResult = await pool.query(`
                SELECT DISTINCT parameter_name 
                FROM ${table} 
                ORDER BY parameter_name
            `);
            console.log(`\nSố parameters: ${paramsResult.rows.length}`);
            if (paramsResult.rows.length > 0) {
                console.log('Danh sách parameters:');
                paramsResult.rows.forEach((row, idx) => {
                    console.log(`  ${idx + 1}. ${row.parameter_name}`);
                });
            }
            
            // Kiểm tra dữ liệu gần đây
            const recentResult = await pool.query(`
                SELECT station_name, parameter_name, value, unit, created_at
                FROM ${table}
                ORDER BY created_at DESC
                LIMIT 5
            `);
            if (recentResult.rows.length > 0) {
                console.log(`\n5 records mới nhất:`);
                recentResult.rows.forEach((row, idx) => {
                    console.log(`  ${idx + 1}. ${row.station_name} - ${row.parameter_name}: ${row.value} ${row.unit}`);
                    console.log(`     Thời gian: ${row.created_at}`);
                });
            }
        }
        
        console.log('\n' + '='.repeat(70));
        console.log('✅ Hoàn thành kiểm tra\n');
        
    } catch (error) {
        console.error('❌ Lỗi:', error.message);
    } finally {
        await pool.end();
    }
}

checkDatabase();
