const axios = require('axios');
const qs = require('qs');

// --- CẤU HÌNH ---
const USERNAME = 'capnuoccamau';
const PASSWORD = 'Qu@nTr@c2121';
const PORTAL_URL = "https://iot.monre.gov.vn/portal/sharing/rest/generateToken";
const DATA_URL = "https://iot.monre.gov.vn/server/rest/services/Hosted/TNN_BIGDATA_EVENT_NEW/FeatureServer/0/query";

// Bộ lọc đơn vị quản lý
const PROJECT_FILTER = "(congtrinh='CAPNUOCCAMAU1' OR congtrinh='CONGTYCOPHANCAPNUOCC' OR congtrinh='NHAMAYCAPNUOCSO1' OR congtrinh='CAPNUOCCAMAUSO2')";
// Map công trình theo giấy phép
const PERMIT_MAPPING = {
    "393/gp-bnnmt 22/09/2025": ["NHAMAYCAPNUOCSO1"],
    "391/gp-bnnmt 19/09/2025": ["CONGTYCOPHANCAPNUOCC"],
    "35/gp-btnmt 15/01/2025": ["CAPNUOCCAMAU1"],
    "36/gp-btnmt 15/01/2025": ["CAPNUOCCAMAUSO2"]
};

// Helper function: Tìm giấy phép theo tên công trình
function getPermitByProject(projectName) {
    if (!projectName) return null;
    
    for (const [permit, projects] of Object.entries(PERMIT_MAPPING)) {
        // So sánh không phân biệt hoa thường và trim khoảng trắng
        if (projects.some(p => p.trim().toUpperCase() === projectName.trim().toUpperCase())) {
            return permit.split(' ')[0]; // Chỉ lấy số giấy phép
        }
    }
    return null;
}

/**
 * 1. Lấy Token xác thực
 */
async function getNewToken() {
    try {
        const response = await axios.post(PORTAL_URL, qs.stringify({
            username: USERNAME,
            password: PASSWORD,
            referer: 'https://iot.monre.gov.vn',
            f: 'json',
            expiration: 60
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        return response.data.token;
    } catch (error) {
        console.error("❌ Không thể lấy Token:", error.message);
        return null;
    }
}

/**
 * 2. Khám phá tất cả các mã trạm (Station ID) hiện có trên API
 */
async function getAllStationIDs(token) {
    const params = {
        f: 'json',
        where: PROJECT_FILTER,
        outFields: 'tram',
        orderByFields: 'thoigiannhan DESC',
        resultRecordCount: 1500000, // Lấy đủ để tìm tất cả trạm unique
        token: token
    };

    try {
        const response = await axios.get(DATA_URL, { params });
        const features = response.data.features || [];
        
        // Lọc distinct values thủ công vì API không hỗ trợ returnDistinctValues tốt
        const uniqueStations = [...new Set(
            features.map(f => f.attributes.tram).filter(Boolean)
        )];
        
        return uniqueStations.sort();
    } catch (error) {
        console.error("❌ Lỗi khi quét danh sách trạm:", error.message);
        return [];
    }
}

/**
 * 3. Tải và xử lý dữ liệu từ tất cả các trạm
 */
async function fetchAndProcessData() {
    console.log("🚀 Đang khởi tạo kết nối tới MONRE IoT...");
    
    const token = await getNewToken();
    if (!token) return;

    // Tự động tìm danh sách trạm
    const stationsOnServer = await getAllStationIDs(token);
    
    if (stationsOnServer.length === 0) {
        console.log("⚠️ Không tìm thấy trạm nào thuộc quyền quản lý của bạn.");
        return;
    }

    const params = {
        f: 'json',
        where: PROJECT_FILTER,
        outFields: '*',
        orderByFields: 'thoigiannhan DESC',
        resultRecordCount: 1500000, // Tăng lên để đủ cho tất cả records (hiện có ~1.2M)
        token: token
    };

    try {
        console.log(`📡 Đang tải dữ liệu của ${stationsOnServer.length} trạm...`);
        const response = await axios.get(DATA_URL, { params });
        const features = response.data.features || [];

        const latestData = {};
        const stationProjects = {}; // Lưu thông tin công trình của từng trạm

        // Nhóm dữ liệu: Mỗi trạm lấy giá trị mới nhất của từng chỉ số (chiso)
        features.forEach(f => {
            const attr = f.attributes;
            const sName = attr.tram;
            const iName = attr.chiso;
            const projectName = attr.congtrinh; // Lấy thông tin công trình từ API

            if (!latestData[sName]) latestData[sName] = {};
            
            // Lưu thông tin công trình của trạm
            if (!stationProjects[sName] && projectName) {
                stationProjects[sName] = projectName;
            }

            // Chỉ lấy bản ghi đầu tiên xuất hiện (vì đã ORDER BY thoigiannhan DESC)
            if (!latestData[sName][iName]) {
                const diffMs = Math.abs(attr.thoigiannhan - attr.thoigiando);
                const diffMinutes = Math.floor(diffMs / (1000 * 60));

                latestData[sName][iName] = {
                    "Chỉ số": iName,
                    "Giá trị": attr.giatri,
                    "Đơn vị": attr.donvido,
                    "Thời gian đo": new Date(attr.thoigiando).toLocaleString('vi-VN'),
                    "Độ trễ (P)": diffMinutes,
                    "Trạng thái": diffMinutes > 60 ? "❌ Mất kết nối" : "✅ Online"
                };
            }
        });

        // HIỂN THỊ KẾT QUẢ THEO NHÓM GIẤY PHÉP
        console.clear();
        console.log("=================================================================================");
        console.log(`📊 BÁO CÁO GIÁM SÁT TRẠM QUAN TRẮC - [${new Date().toLocaleString('vi-VN')}]`);
        console.log(`🏠 Đơn vị: Cấp Nước Cà Mau`);
        console.log(`📈 Tổng số trạm phát hiện: ${stationsOnServer.length}`);
        console.log("=================================================================================\n");

        let activeCount = 0;
        let permitCount = 0;
        const displayedStations = new Set();
        
        // Hiển thị theo nhóm giấy phép
        Object.entries(PERMIT_MAPPING).forEach(([permitNumber, stations]) => {
            permitCount++;
            console.log(`\n${'='.repeat(85)}`);
            console.log(`📋 GIẤY PHÉP ${permitCount}: ${permitNumber}`);
            console.log(`${'='.repeat(85)}`);
            
            let permitStationCount = 0;
            stations.forEach(sName => {
                if (latestData[sName]) {
                    activeCount++;
                    permitStationCount++;
                    displayedStations.add(sName.trim().toUpperCase());
                    console.log(`\n   ${permitStationCount}. 🏨 TRẠM: ${sName}`);
                    
                    // Xác định giấy phép dựa vào công trình thực tế của trạm
                    const projectName = stationProjects[sName];
                    const permit = getPermitByProject(projectName) || permitNumber.split(' ')[0];
                    
                    const dataWithPermit = Object.values(latestData[sName]).map(row => ({
                        "Giấy phép": permit,
                        "Công trình": projectName || "N/A",
                        ...row
                    }));
                    console.table(dataWithPermit);
                } else if (stationsOnServer.includes(sName)) {
                    displayedStations.add(sName.trim().toUpperCase());
                    console.log(`\n   ⚠️ TRẠM: ${sName} - KHÔNG CÓ DỮ LIỆU GẦN ĐÂY`);
                }
            });
            
            if (permitStationCount === 0) {
                console.log("   ⚠️ Không có dữ liệu cho các trạm thuộc giấy phép này");
            }
        });

        // Hiển thị các trạm không có trong mapping (nếu có)
        const unmappedStations = stationsOnServer.filter(s => !displayedStations.has(s.trim().toUpperCase()));
        if (unmappedStations.length > 0) {
            console.log(`\n${'='.repeat(85)}`);
            console.log(`📋 CÁC TRẠM KHÁC (Chưa có thông tin giấy phép)`);
            console.log(`${'='.repeat(85)}`);
            
            let unmappedCount = 0;
            unmappedStations.forEach(sName => {
                if (latestData[sName]) {
                    activeCount++;
                    unmappedCount++;
                    console.log(`\n   ${unmappedCount}. 🏨 TRẠM: ${sName}`);
                    
                    // Xác định giấy phép dựa vào công trình thực tế của trạm
                    const projectName = stationProjects[sName];
                    const permit = getPermitByProject(projectName) || "Chưa có GP";
                    
                    const dataWithPermit = Object.values(latestData[sName]).map(row => ({
                        "Giấy phép": permit,
                        "Công trình": projectName || "N/A",
                        ...row
                    }));
                    console.table(dataWithPermit);
                }
            });
        }

        console.log(`\n${'='.repeat(85)}`);
        console.log(`✅ Hoàn tất: ${activeCount}/${stationsOnServer.length} trạm đang hoạt động.`);
        console.log(`${'='.repeat(85)}`);

    } catch (error) {
        console.error("❌ Lỗi truy vấn API:", error.message);
    }
    
}

// Chạy ứng dụng
fetchAndProcessData();