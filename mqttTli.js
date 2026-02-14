const mqttModule = require('./modules/mqtt');

async function runTest() {
    console.log("======================================");
    console.log("🚀 BẮT ĐẦU TEST MODULE MQTT");
    console.log("⏰ Time:", new Date().toLocaleString());
    console.log("======================================\n");

    try {
        // Kết nối MQTT broker
        console.log("🔌 Đang kết nối MQTT broker...");
        await mqttModule.connectMQTT();
        
        console.log("✅ Kết nối thành công!");
        console.log("⏳ Đang chờ nhận dữ liệu từ 12 trạm (tối đa 60 giây)...\n");
        
        // Đợi cho đến khi nhận đủ 12 trạm hoặc timeout
        const maxWaitTime = 60000; // 60 giây
        const checkInterval = 2000; // kiểm tra mỗi 2 giây
        const startTime = Date.now();
        let data = null;
        
        while (Date.now() - startTime < maxWaitTime) {
            data = mqttModule.getStationsData();
            const stationCount = data?.totalStations || 0;
            
            if (stationCount >= 12) {
                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`✅ Đã nhận đủ ${stationCount} trạm sau ${elapsedTime} giây!`);
                break;
            }
            
            // In tiến trình
            if (stationCount > 0) {
                process.stdout.write(`\r📊 Đã nhận: ${stationCount}/12 trạm...`);
            }
            
            // Đợi trước khi kiểm tra lại
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        console.log("\n"); // Xuống dòng sau progress
        
        // Lấy dữ liệu cuối cùng
        data = mqttModule.getStationsData();
        
        console.log("\n======================================");
        console.log("✅ TEST SUCCESS");
        console.log(`📦 Tổng số trạm: ${data?.totalStations || 0}`);
        
        if (data.stations && Array.isArray(data.stations) && data.stations.length > 0) {
            const totalMeasurements = data.stations.reduce((sum, s) => sum + (s.data?.length || 0), 0);
            console.log(`📊 Tổng số phép đo: ${totalMeasurements}`);
            console.log(`🕐 Cập nhật lần cuối: ${new Date(data.timestamp).toLocaleString()}`);

            console.log("\n📊 DỮ LIỆU:");
            
            const tableData = [];
            data.stations.forEach(station => {
                if (station.data && Array.isArray(station.data)) {
                    station.data.forEach(item => {
                        tableData.push({
                            "Trạm": station.station,
                            "Device": station.deviceName,
                            "Cập nhật": new Date(station.updateTime).toLocaleString('vi-VN'),
                            "Thông số": item.name,
                            "Giá trị": item.value,
                            "Đơn vị": item.unit
                        });
                    });
                }
            });

            if (tableData.length > 0) {
                console.table(tableData);
            } else {
                console.log("⚠ Không có dữ liệu chi tiết.");
            }
        } else {
            console.log("⚠ Không có dữ liệu trả về. Có thể broker chưa gửi message nào.");
        }

        // Ngắt kết nối
        mqttModule.disconnect();

    } catch (error) {
        console.error("\n❌ TEST FAILED");
        console.error("Error message:", error.message);
        console.error("Stack:", error.stack);
        
        // Đảm bảo ngắt kết nối khi có lỗi
        mqttModule.disconnect();
    }

    console.log("\n======================================");
    console.log("🏁 KẾT THÚC TEST");
    console.log("======================================");
    
    // Thoát process
    process.exit(0);
}

runTest();
