/**
 * Script xóa dữ liệu MQTT cho QT2-NM1 (vì MQTT không có trạm này)
 * Chỉ giữ lại dữ liệu TVA cho QT2-NM1 (2186/GP-BTNMT)
 */

const dbModule = require('./modules/database');

async function cleanMQTTQT2NM1() {
    try {
        console.log('🔍 Đang kiểm tra dữ liệu QT2-NM1 trong database...\n');
        
        // Check TVA có QT2-NM1 không
        const tvaCheck = await dbModule.pool.query(`
            SELECT COUNT(*) as count, MAX(timestamp) as latest
            FROM tva_data
            WHERE station_name LIKE '%QT2-NM1%'
        `);
        
        console.log(`📊 TVA QT2-NM1: ${tvaCheck.rows[0].count} records, latest: ${tvaCheck.rows[0].latest || 'N/A'}`);
        
        // Check MQTT có QT2-NM1 không (không nên có)
        const mqttCheck = await dbModule.pool.query(`
            SELECT COUNT(*) as count, MAX(timestamp) as latest
            FROM mqtt_data
            WHERE station_name LIKE '%QT2-NM1%'
        `);
        
        console.log(`📊 MQTT QT2-NM1: ${mqttCheck.rows[0].count} records, latest: ${mqttCheck.rows[0].latest || 'N/A'}`);
        
        if (parseInt(mqttCheck.rows[0].count) > 0) {
            console.log('\n⚠️  Tìm thấy dữ liệu MQTT cho QT2-NM1 (không hợp lệ)');
            console.log('🗑️  Đang xóa dữ liệu MQTT QT2-NM1...');
            
            const deleteResult = await dbModule.pool.query(`
                DELETE FROM mqtt_data
                WHERE station_name LIKE '%QT2-NM1%'
            `);
            
            console.log(`✅ Đã xóa ${deleteResult.rowCount} bản ghi MQTT QT2-NM1`);
        } else {
            console.log('\n✅ Không có dữ liệu MQTT QT2-NM1 cần xóa');
        }
        
        // List all MQTT stations
        console.log('\n📋 Danh sách tất cả MQTT stations trong database:');
        const allMQTT = await dbModule.pool.query(`
            SELECT DISTINCT station_name
            FROM mqtt_data
            ORDER BY station_name
        `);
        
        allMQTT.rows.forEach((row, index) => {
            console.log(`   ${index + 1}. ${row.station_name}`);
        });
        
        console.log(`\n📊 Tổng: ${allMQTT.rows.length} MQTT stations\n`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi:', error.message);
        process.exit(1);
    }
}

// Initialize database and run clean
(async () => {
    await dbModule.initDatabase();
    await cleanMQTTQT2NM1();
})();
