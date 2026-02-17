/**
 * Script theo dõi dữ liệu mới được lưu vào database
 */

const db = require('./modules/database');

async function monitorNewData() {
    console.log('📊 THEO DÕI DỮ LIỆU MỚI TRONG DATABASE...\n');
    console.log('Đang theo dõi trong 30 giây...\n');
    
    const tables = [
        { name: 'tva_data', label: '📊 TVA' },
        { name: 'mqtt_data', label: '📡 MQTT' },
        { name: 'scada_data', label: '🔧 SCADA' }
    ];
    
    try {
        // Get initial counts
        const initialCounts = {};
        for (const table of tables) {
            const result = await db.pool.query(`SELECT COUNT(*) as count FROM ${table.name}`);
            initialCounts[table.name] = parseInt(result.rows[0].count);
        }
        
        console.log('📈 Số lượng records ban đầu:');
        for (const table of tables) {
            console.log(`   ${table.label}: ${initialCounts[table.name].toLocaleString()}`);
        }
        console.log('');
        
        // Monitor for 30 seconds
        let iterations = 0;
        const interval = setInterval(async () => {
            iterations++;
            console.log(`\n⏱️  Kiểm tra lần ${iterations} (${iterations * 5}s)...`);
            
            for (const table of tables) {
                const countResult = await db.pool.query(`SELECT COUNT(*) as count FROM ${table.name}`);
                const currentCount = parseInt(countResult.rows[0].count);
                const diff = currentCount - initialCounts[table.name];
                
                // Get latest record
                const latestResult = await db.pool.query(`
                    SELECT station_name, parameter_name, value, unit,
                           created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at
                    FROM ${table.name}
                    ORDER BY created_at DESC
                    LIMIT 1
                `);
                
                const diffIcon = diff > 0 ? '✅' : '⚪';
                console.log(`   ${diffIcon} ${table.label}: ${currentCount.toLocaleString()} (+${diff})`);
                
                if (latestResult.rows.length > 0) {
                    const row = latestResult.rows[0];
                    const date = new Date(row.created_at);
                    const timeAgo = Math.floor((Date.now() - date.getTime()) / 1000);
                    console.log(`      Mới nhất: ${row.station_name} - ${row.parameter_name}: ${row.value} ${row.unit}`);
                    console.log(`      Thời gian: ${row.created_at} (${timeAgo}s trước)`);
                }
            }
            
            if (iterations >= 6) {
                clearInterval(interval);
                
                // Final summary
                console.log('\n\n📊 TỔNG KẾT:');
                console.log('='.repeat(60));
                let totalNew = 0;
                for (const table of tables) {
                    const countResult = await db.pool.query(`SELECT COUNT(*) as count FROM ${table.name}`);
                    const currentCount = parseInt(countResult.rows[0].count);
                    const diff = currentCount - initialCounts[table.name];
                    totalNew += diff;
                    
                    const status = diff > 0 ? '✅ ĐANG LƯU' : '⚠️  KHÔNG CÓ DỮ LIỆU MỚI';
                    console.log(`   ${table.label}: ${status} (${diff} records mới)`);
                }
                
                console.log(`\n   🎯 Tổng cộng: ${totalNew} records mới trong 30 giây`);
                
                if (totalNew > 0) {
                    console.log('\n   ✅ Database đang hoạt động bình thường!');
                } else {
                    console.log('\n   ⚠️  Không có dữ liệu mới - Kiểm tra server có đang chạy không!');
                }
                
                await db.closeDatabase();
                process.exit(0);
            }
        }, 5000);
        
    } catch (error) {
        console.error('❌ LỖI:', error.message);
        console.error(error.stack);
        await db.closeDatabase();
        process.exit(1);
    }
}

monitorNewData();
