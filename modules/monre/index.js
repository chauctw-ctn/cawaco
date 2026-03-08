const axios = require('axios');

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

// Cache token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Helper function: Tìm giấy phép theo tên công trình
 */
function getPermitByProject(projectName) {
    if (!projectName) return null;
    
    for (const [permit, projects] of Object.entries(PERMIT_MAPPING)) {
        if (projects.some(p => p.trim().toUpperCase() === projectName.trim().toUpperCase())) {
            return permit.split(' ')[0]; // Chỉ lấy số giấy phép
        }
    }
    return null;
}

/**
 * Lấy Token xác thực (with caching)
 */
async function getToken() {
    // Kiểm tra token cache còn hạn không (cho 5 phút buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
        return cachedToken;
    }
    
    try {
        const params = new URLSearchParams({
            username: USERNAME,
            password: PASSWORD,
            referer: 'https://iot.monre.gov.vn',
            f: 'json',
            expiration: 60
        });
        
        const response = await axios.post(PORTAL_URL, params.toString(), { 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 10000
        });
        
        if (response.data && response.data.token) {
            cachedToken = response.data.token;
            // Token expires in 60 minutes
            tokenExpiry = Date.now() + 60 * 60 * 1000;
            return cachedToken;
        }
        
        throw new Error('Invalid token response');
    } catch (error) {
        console.error("❌ Không thể lấy Token MONRE:", error.message);
        throw error;
    }
}

/**
 * Lấy dữ liệu từ MONRE IoT API
 */
async function fetchMonreData() {
    try {
        const token = await getToken();
        
        const params = {
            f: 'json',
            where: PROJECT_FILTER,
            outFields: '*',
            orderByFields: 'thoigiannhan DESC',
            resultRecordCount: 1500000,
            token: token
        };
        
        const response = await axios.get(DATA_URL, { 
            params,
            timeout: 30000 // 30 seconds timeout
        });
        
        const features = response.data.features || [];
        
        if (features.length === 0) {
            console.log('⚠️ Không có dữ liệu từ MONRE IoT');
            return [];
        }
        
        // Process data
        const latestData = {};
        const stationProjects = {};
        
        features.forEach(f => {
            const attr = f.attributes;
            const sName = attr.tram;
            const iName = attr.chiso;
            const projectName = attr.congtrinh;
            
            if (!latestData[sName]) latestData[sName] = {};
            
            // Lưu thông tin công trình của trạm
            if (!stationProjects[sName] && projectName) {
                stationProjects[sName] = projectName;
            }
            
            // Chỉ lấy bản ghi đầu tiên xuất hiện (đã sắp xếp theo thời gian)
            if (!latestData[sName][iName]) {
                const diffMs = Math.abs(attr.thoigiannhan - attr.thoigiando);
                const diffMinutes = Math.floor(diffMs / (1000 * 60));
                
                const projectName = attr.congtrinh;
                const permit = getPermitByProject(projectName) || "Chưa có GP";
                
                latestData[sName][iName] = {
                    station: sName,
                    parameter: iName,
                    value: attr.giatri,
                    unit: attr.donvido,
                    measurementTime: attr.thoigiando,
                    receiveTime: attr.thoigiannhan,
                    delayMinutes: diffMinutes,
                    status: diffMinutes > 60 ? "offline" : "online",
                    project: projectName,
                    permit: permit
                };
            }
        });
        
        // Flatten data to array
        const dataArray = [];
        for (const station in latestData) {
            for (const parameter in latestData[station]) {
                dataArray.push(latestData[station][parameter]);
            }
        }
        
        console.log(`✅ Đã xử lý ${dataArray.length} bản ghi từ MONRE IoT`);
        return dataArray;
        
    } catch (error) {
        console.error('❌ Lỗi lấy dữ liệu MONRE:', error.message);
        throw error;
    }
}

/**
 * Get permit data with caching (cache for 5 minutes)
 */
let dataCache = null;
let cacheExpiry = null;

async function getPermitData(forceRefresh = false) {
    // Return cached data if still valid and not forcing refresh
    if (!forceRefresh && dataCache && cacheExpiry && Date.now() < cacheExpiry) {
        return dataCache;
    }
    
    try {
        const data = await fetchMonreData();
        dataCache = data;
        cacheExpiry = Date.now() + 5 * 60 * 1000; // Cache for 5 minutes
        return data;
    } catch (error) {
        // If fetch fails but we have cached data, return it
        if (dataCache) {
            console.log('⚠️ Sử dụng dữ liệu cache do lỗi fetch');
            return dataCache;
        }
        throw error;
    }
}

/**
 * Get station history (last 30 days data for a specific station)
 */
async function getStationHistory(stationName, days = 30) {
    try {
        const token = await getToken();
        
        // Calculate timestamp for 30 days ago
        const now = Date.now();
        const daysAgo = now - (days * 24 * 60 * 60 * 1000);
        
        // Query for specific station within date range
        const stationFilter = `${PROJECT_FILTER} AND tram='${stationName.replace(/'/g, "''")}' AND thoigiando >= ${daysAgo}`;
        
        const params = {
            f: 'json',
            where: stationFilter,
            outFields: '*',
            orderByFields: 'thoigiando DESC',
            resultRecordCount: 10000, // High limit to get all records within date range
            token: token
        };
        
        const response = await axios.get(DATA_URL, { 
            params,
            timeout: 30000
        });
        
        const features = response.data.features || [];
        
        if (features.length === 0) {
            console.log(`⚠️ Không có dữ liệu lịch sử cho trạm: ${stationName} trong ${days} ngày qua`);
            return [];
        }
        
        // Process history data
        const historyData = features.map(f => {
            const attr = f.attributes;
            const projectName = attr.congtrinh;
            const permit = getPermitByProject(projectName) || "Chưa có GP";
            
            // Convert timestamp to Date object
            const measurementDate = new Date(attr.thoigiando);
            const formattedTime = measurementDate.toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            return {
                station_name: attr.tram,
                parameter_name: attr.chiso,
                value: attr.giatri,
                unit: attr.donvido,
                timestamp: attr.thoigiando,
                time: formattedTime,
                project: projectName,
                permit: permit
            };
        });
        
        console.log(`✅ Lấy được ${historyData.length} records lịch sử cho trạm: ${stationName} trong ${days} ngày qua`);
        return historyData;
        
    } catch (error) {
        console.error(`❌ Lỗi lấy lịch sử trạm ${stationName}:`, error.message);
        throw error;
    }
}

module.exports = {
    getPermitData,
    fetchMonreData,
    getStationHistory
};
