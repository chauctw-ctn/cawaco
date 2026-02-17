/**
 * Script kiểm tra kết nối và dữ liệu PostgreSQL
 */

const db = require('./modules/database');

async function testDatabase() {
    console.log('🔍 BẮT ĐẦU KIỂM TRA DATABASE...\n');
    
    try {
        // 1. Test connection
        console.log('1️⃣ Kiểm tra kết nối...');
        const timeResult = await db.pool.query('SELECT NOW() as current_time, current_database() as db_name');
        console.log('✅ Kết nối thành công!');
        console.log('   Database:', timeResult.rows[0].db_name);
        console.log('   Thời gian server:', timeResult.rows[0].current_time);
        console.log('');
        
        // 2. Check tables exist
        console.log('2️⃣ Kiểm tra các bảng...');
        const tablesResult = await db.pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        console.log('✅ Các bảng có sẵn:');
        tablesResult.rows.forEach(row => {
            console.log('   -', row.table_name);
        });
        console.log('');
        
        // 3. Count records in each data table
        console.log('3️⃣ Đếm số lượng records...');
        const dataTables = ['tva_data', 'mqtt_data', 'scada_data', 'stations', 'visitor_stats'];
        
        for (const table of dataTables) {
            try {
                const countResult = await db.pool.query(`SELECT COUNT(*) as count FROM ${table}`);
                const count = parseInt(countResult.rows[0].count);
                console.log(`   ${table}: ${count.toLocaleString()} records`);
            } catch (err) {
                console.log(`   ${table}: ❌ ${err.message}`);
            }
        }
        console.log('');
        
        // 4. Get latest data from each table
        console.log('4️⃣ Dữ liệu mới nhất từ mỗi bảng...');
        
        // TVA Data
        try {
            const tvaResult = await db.pool.query(`
                SELECT station_name, parameter_name, value, unit, 
                       created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at
                FROM tva_data 
                ORDER BY created_at DESC 
                LIMIT 3
            `);
            console.log('   📊 TVA Data (3 records mới nhất):');
            tvaResult.rows.forEach(row => {
                console.log(`      - ${row.station_name} | ${row.parameter_name}: ${row.value} ${row.unit}`);
                console.log(`        ⏰ ${row.created_at}`);
            });
        } catch (err) {
            console.log('   📊 TVA Data: ❌', err.message);
        }
        console.log('');
        
        // MQTT Data
        try {
            const mqttResult = await db.pool.query(`
                SELECT station_name, parameter_name, value, unit,
                       created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at
                FROM mqtt_data 
                ORDER BY created_at DESC 
                LIMIT 3
            `);
            console.log('   📡 MQTT Data (3 records mới nhất):');
            mqttResult.rows.forEach(row => {
                console.log(`      - ${row.station_name} | ${row.parameter_name}: ${row.value} ${row.unit}`);
                console.log(`        ⏰ ${row.created_at}`);
            });
        } catch (err) {
            console.log('   📡 MQTT Data: ❌', err.message);
        }
        console.log('');
        
        // SCADA Data
        try {
            const scadaResult = await db.pool.query(`
                SELECT station_name, parameter_name, value, unit,
                       created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at
                FROM scada_data 
                ORDER BY created_at DESC 
                LIMIT 3
            `);
            console.log('   🔧 SCADA Data (3 records mới nhất):');
            scadaResult.rows.forEach(row => {
                console.log(`      - ${row.station_name} | ${row.parameter_name}: ${row.value} ${row.unit}`);
                console.log(`        ⏰ ${row.created_at}`);
            });
        } catch (err) {
            console.log('   🔧 SCADA Data: ❌', err.message);
        }
        console.log('');
        
        // 5. Check stations
        console.log('5️⃣ Danh sách trạm...');
        try {
            const stationsResult = await db.pool.query(`
                SELECT station_type, COUNT(*) as count 
                FROM stations 
                GROUP BY station_type 
                ORDER BY station_type
            `);
            console.log('   📍 Số lượng trạm theo loại:');
            stationsResult.rows.forEach(row => {
                console.log(`      ${row.station_type}: ${row.count} trạm`);
            });
            
            const totalStations = await db.pool.query('SELECT COUNT(*) as total FROM stations');
            console.log(`   📍 Tổng cộng: ${totalStations.rows[0].total} trạm`);
        } catch (err) {
            console.log('   📍 Stations: ❌', err.message);
        }
        console.log('');
        
        // 6. Check visitor stats
        console.log('6️⃣ Thống kê visitor...');
        try {
            const visitorResult = await db.pool.query(`
                SELECT total_visitors, today_date, today_visitors, created_at
                FROM visitor_stats
                ORDER BY id DESC
                LIMIT 1
            `);
            if (visitorResult.rows.length > 0) {
                const stats = visitorResult.rows[0];
                console.log(`   👥 Tổng visitors: ${parseInt(stats.total_visitors).toLocaleString()}`);
                console.log(`   📅 Ngày hôm nay: ${stats.today_date}`);
                console.log(`   👤 Visitors hôm nay: ${stats.today_visitors}`);
                console.log(`   ⏰ Cập nhật lúc: ${stats.created_at}`);
            } else {
                console.log('   ⚠️ Chưa có dữ liệu visitor');
            }
        } catch (err) {
            console.log('   👥 Visitor Stats: ❌', err.message);
        }
        console.log('');
        
        // 7. Check data freshness
        console.log('7️⃣ Kiểm tra độ tươi của dữ liệu...');
        const tables = [
            { name: 'tva_data', label: 'TVA' },
            { name: 'mqtt_data', label: 'MQTT' },
            { name: 'scada_data', label: 'SCADA' }
        ];
        
        for (const table of tables) {
            try {
                const freshnessResult = await db.pool.query(`
                    SELECT 
                        MAX(created_at) as latest_time,
                        EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/60 as minutes_ago
                    FROM ${table.name}
                `);
                
                if (freshnessResult.rows[0].latest_time) {
                    const minutesAgo = Math.floor(freshnessResult.rows[0].minutes_ago);
                    const status = minutesAgo < 60 ? '✅' : '⚠️';
                    console.log(`   ${status} ${table.label}: ${minutesAgo} phút trước`);
                    console.log(`      ${freshnessResult.rows[0].latest_time}`);
                } else {
                    console.log(`   ⚠️ ${table.label}: Chưa có dữ liệu`);
                }
            } catch (err) {
                console.log(`   ❌ ${table.label}: ${err.message}`);
            }
        }
        console.log('');
        
        console.log('✅ HOÀN THÀNH KIỂM TRA!\n');
        
    } catch (error) {
        console.error('❌ LỖI:', error.message);
        console.error(error.stack);
    } finally {
        // Close connection
        await db.closeDatabase();
        process.exit(0);
    }
}

// Run test
testDatabase();
