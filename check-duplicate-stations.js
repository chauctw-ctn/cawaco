/**
 * Script kiểm tra các trạm bị duplicate trong database
 */

const dbModule = require('./modules/database');

async function checkDuplicates() {
    try {
        console.log('🔍 Đang kiểm tra duplicate stations trong database...\n');
        
        // Check TVA duplicates
        console.log('📊 Kiểm tra TVA stations:');
        const tvaResult = await dbModule.pool.query(`
            SELECT 
                station_name,
                COUNT(*) as count,
                array_agg(DISTINCT timestamp ORDER BY timestamp DESC) as timestamps
            FROM (
                SELECT DISTINCT station_name, timestamp
                FROM tva_data
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            ) as recent
            GROUP BY station_name
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `);
        
        if (tvaResult.rows.length > 0) {
            console.log(`   ⚠️  Tìm thấy ${tvaResult.rows.length} TVA stations có nhiều timestamps:`);
            tvaResult.rows.forEach(row => {
                console.log(`      • ${row.station_name}: ${row.count} timestamps`);
            });
        } else {
            console.log('   ✅ Không có duplicate TVA stations\n');
        }
        
        // Check MQTT duplicates
        console.log('\n📊 Kiểm tra MQTT stations:');
        const mqttResult = await dbModule.pool.query(`
            SELECT 
                station_name,
                COUNT(*) as count,
                array_agg(DISTINCT timestamp ORDER BY timestamp DESC) as timestamps
            FROM (
                SELECT DISTINCT station_name, timestamp
                FROM mqtt_data
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            ) as recent
            GROUP BY station_name
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `);
        
        if (mqttResult.rows.length > 0) {
            console.log(`   ⚠️  Tìm thấy ${mqttResult.rows.length} MQTT stations có nhiều timestamps:`);
            mqttResult.rows.forEach(row => {
                console.log(`      • ${row.station_name}: ${row.count} timestamps`);
            });
        } else {
            console.log('   ✅ Không có duplicate MQTT stations\n');
        }
        
        // Check stations with similar names (QT2)
        console.log('\n🔍 Kiểm tra stations có tên giống "QT2":');
        
        const qt2TVA = await dbModule.pool.query(`
            SELECT DISTINCT station_name, 'TVA' as type
            FROM tva_data
            WHERE station_name LIKE '%QT2%'
            ORDER BY station_name
        `);
        
        const qt2MQTT = await dbModule.pool.query(`
            SELECT DISTINCT station_name, 'MQTT' as type
            FROM mqtt_data
            WHERE station_name LIKE '%QT2%'
            ORDER BY station_name
        `);
        
        const qt2SCADA = await dbModule.pool.query(`
            SELECT DISTINCT station_name, 'SCADA' as type
            FROM scada_data
            WHERE station_name LIKE '%QT2%'
            ORDER BY station_name
        `);
        
        console.log('\n   TVA stations có "QT2":');
        if (qt2TVA.rows.length > 0) {
            qt2TVA.rows.forEach(row => console.log(`      • ${row.station_name}`));
        } else {
            console.log('      (không có)');
        }
        
        console.log('\n   MQTT stations có "QT2":');
        if (qt2MQTT.rows.length > 0) {
            qt2MQTT.rows.forEach(row => console.log(`      • ${row.station_name}`));
        } else {
            console.log('      (không có)');
        }
        
        console.log('\n   SCADA stations có "QT2":');
        if (qt2SCADA.rows.length > 0) {
            qt2SCADA.rows.forEach(row => console.log(`      • ${row.station_name}`));
        } else {
            console.log('      (không có)');
        }
        
        // Check all distinct stations
        console.log('\n📊 Tổng số stations trong database:');
        const allStations = await dbModule.pool.query(`
            SELECT 'TVA' as type, COUNT(DISTINCT station_name) as count FROM tva_data
            UNION ALL
            SELECT 'MQTT' as type, COUNT(DISTINCT station_name) as count FROM mqtt_data
            UNION ALL
            SELECT 'SCADA' as type, COUNT(DISTINCT station_name) as count FROM scada_data
        `);
        
        allStations.rows.forEach(row => {
            console.log(`   ${row.type}: ${row.count} stations`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Lỗi:', error.message);
        process.exit(1);
    }
}

// Initialize database and run check
(async () => {
    await dbModule.initDatabase();
    await checkDuplicates();
})();
