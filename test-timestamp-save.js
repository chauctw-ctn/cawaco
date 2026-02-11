// Test save data với timestamp hiện tại GMT+7
const { pool, saveTVAData, saveMQTTData, saveSCADAData } = require('./database');

async function testTimestamp() {
    try {
        console.log('🧪 Testing timestamp save functionality...\n');
        
        // Get current time trước khi save
        const beforeSave = new Date();
        console.log('⏰ Time BEFORE save:  ', beforeSave.toISOString());
        console.log('🇻🇳 Vietnam local time:', beforeSave.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
        console.log('');
        
        // Test data với timestamp từ "API" (giả lập old timestamp)
        const fakeOldTimestamp = new Date('2025-01-01T00:00:00Z');
        const testTVAData = [
            {
                station: 'TEST_STATION_TIMESTAMP',
                updateTime: fakeOldTimestamp.toISOString(), // Timestamp cũ từ "API"
                data: [
                    { name: 'Test Parameter', value: 99.99, unit: 'test' }
                ]
            }
        ];
        
        // Lưu dữ liệu
        console.log('💾 Saving test data with FAKE OLD timestamp from API:', fakeOldTimestamp.toISOString());
        await saveTVAData(testTVAData);
        console.log('✅ Data saved!\n');
        
        // Wait 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get current time sau khi save
        const afterSave = new Date();
        console.log('⏰ Time AFTER save:   ', afterSave.toISOString());
        console.log('');
        
        // Query lại để check timestamp
        const result = await pool.query(`
            SELECT station_name, parameter_name, value, timestamp, update_time, created_at
            FROM tva_data
            WHERE station_name = 'TEST_STATION_TIMESTAMP'
            ORDER BY id DESC
            LIMIT 1
        `);
        
        if (result.rows.length > 0) {
            const saved = result.rows[0];
            console.log('📊 Saved data in database:');
            console.log('   Station:        ', saved.station_name);
            console.log('   Parameter:      ', saved.parameter_name);
            console.log('   Value:          ', saved.value);
            console.log('   timestamp:      ', saved.timestamp);
            console.log('   update_time:    ', saved.update_time);
            console.log('   created_at:     ', saved.created_at);
            console.log('');
            
            // Compare timestamps
            const savedTime = new Date(saved.timestamp);
            const timeDiff = Math.abs(savedTime - beforeSave) / 1000; // seconds
            
            console.log('✅ Verification:');
            console.log('   Fake OLD timestamp from API: ', fakeOldTimestamp.toISOString());
            console.log('   ACTUAL saved timestamp:      ', savedTime.toISOString());
            console.log('   Time difference (seconds):   ', timeDiff.toFixed(2), 's');
            console.log('');
            
            if (timeDiff < 5) {
                console.log('✅ SUCCESS! Timestamp được lưu đúng theo thời gian hiện tại');
                console.log('✅ Không sử dụng timestamp cũ từ API');
            } else {
                console.log('⚠️ WARNING: Timestamp có vẻ không đúng');
            }
        } else {
            console.log('❌ No data found');
        }
        
        // Cleanup test data
        console.log('\n🗑️ Cleaning up test data...');
        await pool.query("DELETE FROM tva_data WHERE station_name = 'TEST_STATION_TIMESTAMP'");
        await pool.query("DELETE FROM stations WHERE station_id LIKE '%TEST_STATION_TIMESTAMP%'");
        console.log('✅ Test data cleaned up');
        
        await pool.end();
        console.log('\n✅ Test completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testTimestamp();
