const tvaModule = require('./modules/tva');

async function runTest() {
    console.log("======================================");
    console.log("🚀 BẮT ĐẦU TEST MODULE TVA");
    console.log("⏰ Time:", new Date().toLocaleString());
    console.log("======================================\n");

    try {
        const stations = await tvaModule.getTVADataWithRetry();

        console.log("✅ TEST SUCCESS");
        console.log(`📦 Tổng số trạm: ${stations?.length || 0}`);
        
        if (Array.isArray(stations) && stations.length > 0) {
            const totalMeasurements = stations.reduce((sum, s) => sum + (s.data?.length || 0), 0);
            console.log(`📊 Tổng số phép đo: ${totalMeasurements}`);

            console.log("\n📊 DỮ LIỆU:");
            
            const tableData = [];
            stations.forEach(station => {
                if (station.data && Array.isArray(station.data)) {
                    station.data.forEach(item => {
                        tableData.push({
                            "Trạm": station.station,
                            "Cập nhật": station.updateTime,
                            "Thông số": item.name,
                            "Thời gian đo": item.time,
                            "Giá trị": item.value,
                            "Đơn vị": item.unit,
                            "Giới hạn": item.limit || "-"
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
            console.log("⚠ Không có dữ liệu trả về.");
        }

    } catch (error) {
        console.error("❌ TEST FAILED");
        console.error("Error message:", error.message);
        console.error("Stack:", error.stack);
    }

    console.log("\n======================================");
    console.log("🏁 KẾT THÚC TEST");
    console.log("======================================");
}

runTest();

