const scadaModule = require('./modules/scada');

async function runTest() {
    console.log("======================================");
    console.log("🚀 BẮT ĐẦU TEST MODULE SCADA");
    console.log("⏰ Time:", new Date().toLocaleString());
    console.log("======================================\n");

    try {
        const data = await scadaModule.getSCADADataWithRetry();

        console.log("✅ TEST SUCCESS");
        console.log(`📦 Tổng số record: ${data?.length || 0}`);

        if (Array.isArray(data) && data.length > 0) {
            console.log("\n📊 DỮ LIỆU:");
            console.table(
                data.map(item => ({
                    ChannelID: item.channelNumber,
                    Station: item.name,
                    Parameter: item.parameterName,
                    Value: item.value,
                    Unit: item.unit,
                    Status: item.status
                }))
            );
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
