/**
 * Script: Liệt kê danh sách các Giếng/Trạm bơm theo nhóm giấy phép
 * Lấy dữ liệu từ MONRE IoT API (không kể các trạm quan trắc)
 * Tính công suất hoạt động từ PostgreSQL (Tổng lưu lượng 30 ngày gần nhất)
 */

const axios = require('axios');
const { Pool } = require('pg');
const config = require('./config');

// --- CẤU HÌNH MONRE API ---
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

/**
 * Kiểm tra xem trạm có phải là trạm quan trắc không
 * Loại trừ các trạm có chứa: QT, Quan trắc, QTNN, etc
 */
function isMonitoringStation(stationName) {
    if (!stationName) return false;
    
    const name = stationName.toUpperCase();
    const monitoringKeywords = [
        'QT',           // Quan trắc (QT1, QT2, QT3, ...)
        'QUAN TRAC',
        'QUAN TRẮC',
        'QUANTRAC',
        'QTNN',         // Quan trắc nước ngầm
        'QTNT',         // Quan trắc nước thải
        'QTMT',         // Quan trắc môi trường
        'MONITORING'
    ];
    
    // Kiểm tra xem có bắt đầu bằng QT hoặc chứa QT ngay sau ký tự đặc biệt
    if (name.startsWith('QT') || name.includes('_QT') || name.includes(' QT')) {
        return true;
    }
    
    return monitoringKeywords.some(keyword => name.includes(keyword));
}

/**
 * Kiểm tra xem trạm có phải là Giếng/Trạm bơm không
 */
function isWellOrPumpStation(stationName) {
    if (!stationName) return false;
    
    const name = stationName.toUpperCase();
    
    // Các pattern cho Giếng/Trạm bơm
    // G + số: G1, G2, G12, G26, ...
    // GS + số: GS1NM1, GS2NM2, ...
    // CLN + GS: CLNGS4NM2 (Clo dư tại Giếng Số)
    // GIẾNG, GIENG, TRẠM, TRAM
    
    const patterns = [
        /^G\d+$/,                    // G1, G2, G26, G27, ...
        /^GS\d+/,                    // GS1NM1, GS2NM2, GS3NM1, ...
        /^CLN(G|GS)/,                // CLNGS4NM2, CLNGS5NM1
        /GIENG|GIẾNG/,               // Giếng
        /TRAM\s*BOM|TRẠM\s*BƠM/,    // Trạm bơm
        /TRAM(\d+|$)/,               // Trạm 1, Trạm 2, etc hoặc chỉ "Trạm"
        /WELL|PUMP/                  // Well, Pump (tiếng Anh)
    ];
    
    return patterns.some(pattern => pattern.test(name));
}

/**
 * Tìm giấy phép theo tên công trình
 */
function getPermitByProject(projectName) {
    if (!projectName) return null;
    
    for (const [permit, projects] of Object.entries(PERMIT_MAPPING)) {
        if (projects.some(p => p.trim().toUpperCase() === projectName.trim().toUpperCase())) {
            return permit;
        }
    }
    return null;
}

/**
 * Lấy Token xác thực từ MONRE
 */
async function getToken() {
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
            return response.data.token;
        }
        
        throw new Error('Invalid token response');
    } catch (error) {
        console.error("❌ Không thể lấy Token MONRE:", error.message);
        throw error;
    }
}

/**
 * Lấy danh sách tất cả các trạm từ MONRE IoT
 */
async function fetchAllStations() {
    try {
        console.log('🔄 Đang lấy dữ liệu từ MONRE IoT API...\n');
        
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
            timeout: 30000
        });
        
        const features = response.data.features || [];
        
        if (features.length === 0) {
            console.log('⚠️ Không có dữ liệu từ MONRE IoT');
            return [];
        }
        
        console.log(`📥 Đã nhận ${features.length} records từ MONRE IoT`);
        
        // Tạo danh sách trạm với thông tin công trình
        const stations = [];
        const seenStations = new Set(); // Để tránh trùng lặp
        const stationProjects = {}; // Map trạm -> công trình
        
        features.forEach(f => {
            const attr = f.attributes;
            const stationName = attr.tram;
            const projectName = attr.congtrinh;
            
            if (!stationName) return;
            
            // Lưu thông tin công trình của trạm (lần đầu gặp)
            if (!stationProjects[stationName]) {
                stationProjects[stationName] = projectName;
            }
            
            // Bỏ qua nếu đã xử lý trạm này
            if (seenStations.has(stationName)) {
                return;
            }
            
            seenStations.add(stationName);
            
            // Bỏ qua các trạm quan trắc
            if (isMonitoringStation(stationName)) {
                console.log(`   ⏭️  Bỏ qua trạm quan trắc: ${stationName}`);
                return;
            }
            
            // Chỉ lấy các Giếng/Trạm bơm
            if (!isWellOrPumpStation(stationName)) {
                console.log(`   ⏭️  Bỏ qua (không phải Giếng/Trạm bơm): ${stationName}`);
                return;
            }
            
            const permit = getPermitByProject(projectName);
            
            stations.push({
                stationName: stationName,
                projectName: projectName,
                permit: permit || "Chưa có GP"
            });
        });
        
        return stations;
        
    } catch (error) {
        console.error('❌ Lỗi lấy dữ liệu MONRE:', error.message);
        throw error;
    }
}

/**
 * Nhóm các trạm theo giấy phép
 */
function groupStationsByPermit(stations) {
    const grouped = {};
    
    stations.forEach(station => {
        const permit = station.permit;
        
        if (!grouped[permit]) {
            grouped[permit] = [];
        }
        
        grouped[permit].push(station);
    });
    
    // Sắp xếp các trạm trong mỗi nhóm theo tên
    Object.keys(grouped).forEach(permit => {
        grouped[permit].sort((a, b) => a.stationName.localeCompare(b.stationName, 'vi'));
    });
    
    return grouped;
}

/**
 * In ra kết quả
 */
function printResults(groupedStations) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  DANH SÁCH CÁC GIẾNG/TRẠM BƠM THEO NHÓM GIẤY PHÉP');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    // Tính tổng số trạm
    let totalStations = 0;
    Object.values(groupedStations).forEach(stations => {
        totalStations += stations.length;
    });
    
    console.log(`📊 TỔNG QUAN:`);
    console.log(`   - Số nhóm giấy phép: ${Object.keys(groupedStations).length}`);
    console.log(`   - Tổng số trạm: ${totalStations}\n`);
    
    // Sắp xếp các giấy phép
    const sortedPermits = Object.keys(groupedStations).sort();
    
    sortedPermits.forEach((permit, index) => {
        const stations = groupedStations[permit];
        
        console.log(`\n${'─'.repeat(67)}`);
        console.log(`📋 NHÓM ${index + 1}: ${permit}`);
        console.log(`   Số lượng trạm: ${stations.length}`);
        console.log(`${'─'.repeat(67)}`);
        
        stations.forEach((station, idx) => {
            console.log(`   ${String(idx + 1).padStart(3, ' ')}. ${station.stationName}`);
            console.log(`        Công trình: ${station.projectName}`);
        });
    });
    
    console.log(`\n${'═'.repeat(67)}`);
}

/**
 * Xuất kết quả ra file JSON
 */
function exportToJSON(groupedStations, filename = 'stations-by-permit.json') {
    const fs = require('fs');
    
    const output = {
        exportDate: new Date().toISOString(),
        totalGroups: Object.keys(groupedStations).length,
        totalStations: Object.values(groupedStations).reduce((sum, arr) => sum + arr.length, 0),
        data: groupedStations
    };
    
    fs.writeFileSync(filename, JSON.stringify(output, null, 2), 'utf8');
    console.log(`\n💾 Đã xuất dữ liệu ra file: ${filename}`);
}

/**
 * Khởi tạo kết nối PostgreSQL
 */
function createDatabasePool() {
    return new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
}

/**
 * Lấy dữ liệu "Tổng lưu lượng" từ PostgreSQL cho các trạm trong 30 ngày gần nhất
 */
async function getFlowDataLast30Days(pool, stationNames) {
    const tables = ['tva_data', 'mqtt_data', 'scada_data'];
    const flowData = {};
    
    // Set timezone
    await pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
    
    const now = new Date();
    
    // Tháng hiện tại
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Tháng trước
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    
    console.log(`   📅 Tháng trước: ${lastMonthStart.toISOString()} đến ${lastMonthEnd.toISOString()}`);
    console.log(`   📅 Tháng hiện tại: ${currentMonthStart.toISOString()} đến ${now.toISOString()}`);
    
    for (const table of tables) {
        try {
            // Query để lấy dữ liệu từ đầu tháng trước đến hiện tại
            const query = `
                SELECT 
                    station_name,
                    parameter_name,
                    value,
                    unit,
                    created_at
                FROM ${table}
                WHERE 
                    (
                        parameter_name ILIKE '%tổng lưu lượng%' 
                        OR parameter_name ILIKE '%tong luu luong%'
                        OR parameter_name ILIKE '%total flow%'
                    )
                    AND created_at >= $1
                    AND value IS NOT NULL
                ORDER BY station_name, created_at ASC
            `;
            
            const result = await pool.query(query, [lastMonthStart]);
            
            console.log(`   📊 ${table}: ${result.rows.length} records`);
            
            // Nhóm dữ liệu theo trạm
            result.rows.forEach(row => {
                const stationName = row.station_name;
                
                if (!flowData[stationName]) {
                    flowData[stationName] = {
                        stationName: stationName,
                        lastMonthRecords: [],
                        currentMonthRecords: [],
                        unit: row.unit,
                        source: table.replace('_data', '').toUpperCase()
                    };
                }
                
                const timestamp = new Date(row.created_at);
                const record = {
                    value: parseFloat(row.value) || 0,
                    timestamp: timestamp,
                    parameter: row.parameter_name
                };
                
                // Phân loại record vào tháng trước hoặc tháng hiện tại
                if (timestamp >= lastMonthStart && timestamp <= lastMonthEnd) {
                    flowData[stationName].lastMonthRecords.push(record);
                }
                if (timestamp >= currentMonthStart) {
                    flowData[stationName].currentMonthRecords.push(record);
                }
            });
            
        } catch (err) {
            console.error(`⚠️ Lỗi query ${table}:`, err.message);
        }
    }
    
    // Tính toán công suất cho mỗi trạm
    Object.keys(flowData).forEach(stationName => {
        const data = flowData[stationName];
        
        // Tính công suất tháng trước (đã hoàn thành)
        data.lastMonthCapacity = 0;
        if (data.lastMonthRecords.length > 0) {
            data.lastMonthRecords.sort((a, b) => a.timestamp - b.timestamp);
            const firstValue = data.lastMonthRecords[0].value;
            const lastValue = data.lastMonthRecords[data.lastMonthRecords.length - 1].value;
            
            if (lastValue >= firstValue) {
                data.lastMonthCapacity = lastValue - firstValue;
            } else {
                data.lastMonthCapacity = lastValue;
            }
        }
        
        // Tính công suất tháng hiện tại (từ đầu tháng đến nay)
        data.currentMonthCapacity = 0;
        data.latestValue = 0;
        if (data.currentMonthRecords.length > 0) {
            data.currentMonthRecords.sort((a, b) => a.timestamp - b.timestamp);
            const firstValue = data.currentMonthRecords[0].value;
            const lastValue = data.currentMonthRecords[data.currentMonthRecords.length - 1].value;
            
            data.latestValue = lastValue;
            
            if (lastValue >= firstValue) {
                data.currentMonthCapacity = lastValue - firstValue;
            } else {
                data.currentMonthCapacity = lastValue;
            }
        }
        
        // Làm tròn 2 chữ số thập phân
        data.lastMonthCapacity = Math.round(data.lastMonthCapacity * 100) / 100;
        data.currentMonthCapacity = Math.round(data.currentMonthCapacity * 100) / 100;
        data.latestValue = Math.round(data.latestValue * 100) / 100;
        
        // Giữ lại thuộc tính cũ để tương thích
        data.totalFlow = data.currentMonthCapacity;
        data.recordCount = data.currentMonthRecords.length + data.lastMonthRecords.length;
    });
    
    return flowData;
}

/**
 * Phân loại trạm theo giấy phép dựa trên tên
 * 
 * PHÂN BỔ GIẤY PHÉP:
 * - Giấy phép 35: 12 giếng (G1, G2, G4, G12, G15, G18, G20, G22, G23, G24, G25, G27)
 * - Giấy phép 36: 4 giếng/trạm Nhà máy số 2 (NM2)
 * - Giấy phép 391: 2 trạm bơm (21 và 26)
 * - Giấy phép 393: 5 giếng/trạm bơm Nhà máy số 1 (NM1)
 * TỔNG: 23 giếng/trạm
 */
function classifyStationByName(stationName) {
    if (!stationName) return null;
    
    const name = stationName.toUpperCase();
    
    // QUAN TRỌNG: Thứ tự kiểm tra từ cụ thể đến chung
    // Check NM1/NM2 trước để tránh nhầm với các giếng G1-G27
    
    // 36/gp-btnmt 15/01/2025: CAPNUOCCAMAUSO2 - Nhà máy số 2 (4 giếng/trạm)
    // Pattern: NM2, NHA MAY SO 2, GS1NM2, GS2NM2, GS3NM2, GS4NM2, GIẾNG X NM2
    if (name.includes('NM2') || 
        name.includes('NHÀ MÁY SỐ 2') || 
        name.includes('NHA MAY SO 2') ||
        name.includes('NHÀ MÁY 2') ||
        name.includes('NHA MAY 2') ||
        /GS\d*NM2/.test(name) || // GS1NM2, GS2NM2, GS3NM2, GS4NM2, GSNM2
        /GIẾNG\s*\d*\s*NM2/.test(name) || // GIẾNG 1 NM2, GIẾNG NM2
        /GIENG\s*\d*\s*NM2/.test(name)) { // GIENG 1 NM2, GIENG NM2
        return '36/gp-btnmt 15/01/2025';
    }
    
    // 393/gp-bnnmt 22/09/2025: NHAMAYCAPNUOCSO1 - Nhà máy số 1 (5 giếng/trạm bơm)
    // Pattern: NM1, NHA MAY SO 1, GS1NM1, GS2NM1, GS3NM1, GS4NM1, GS5NM1, GIẾNG X NM1
    if (name.includes('NM1') || 
        name.includes('NHÀ MÁY SỐ 1') || 
        name.includes('NHA MAY SO 1') ||
        name.includes('NHÀ MÁY 1') ||
        name.includes('NHA MAY 1') ||
        /GS\d*NM1/.test(name) || // GS1NM1, GS2NM1, GS3NM1, GS4NM1, GS5NM1, GSNM1
        /GIẾNG\s*\d*\s*NM1/.test(name) || // GIẾNG 1 NM1, GIẾNG NM1
        /GIENG\s*\d*\s*NM1/.test(name)) { // GIENG 1 NM1, GIENG NM1
        return '393/gp-bnnmt 22/09/2025';
    }
    
    // 391/gp-bnnmt 19/09/2025: CONGTYCOPHANCAPNUOCC - Trạm bơm 21 và 26 (2 trạm)
    if (name.includes('21') && (name.includes('TRẠM BƠM') || name.includes('TRAM BOM'))) {
        return '391/gp-bnnmt 19/09/2025';
    }
    if (name.includes('26') && (name.includes('TRẠM BƠM') || name.includes('TRAM BOM'))) {
        return '391/gp-bnnmt 19/09/2025';
    }
    
    // 35/gp-btnmt 15/01/2025: CAPNUOCCAMAU1 - CHỈ 12 giếng cụ thể
    // DANH SÁCH CHÍNH THỨC: G1, G2, G4, G12, G15, G18, G20, G22, G23, G24, G25, G27
    // LOẠI TRỪ: Số 16 (KHÔNG thuộc giấy phép 35)
    const permit35Numbers = ['1', '2', '4', '12', '15', '18', '20', '22', '23', '24', '25', '27'];
    const excludedNumbers = ['16']; // Số bị loại trừ khỏi giấy phép 35
    
    // Kiểm tra nếu trạm bị loại trừ (số 16)
    for (const excludedNum of excludedNumbers) {
        if (name === `G${excludedNum}` || name === `G ${excludedNum}` ||
            name === `GIẾNG ${excludedNum}` || name === `GIENG ${excludedNum}` ||
            name === `GIẾNG${excludedNum}` || name === `GIENG${excludedNum}` ||
            name.startsWith(`G${excludedNum} `) || name.startsWith(`G ${excludedNum} `) ||
            name.startsWith(`GIẾNG ${excludedNum} `) || name.startsWith(`GIENG ${excludedNum} `) ||
            (name.includes(`TRẠM`) && name.includes(excludedNum))) {
            return null; // Trả về null để không phân loại vào giấy phép nào
        }
    }
    
    // Kiểm tra từng số giếng trong danh sách giấy phép 35
    for (const num of permit35Numbers) {
        // Pattern 1: G + số (G1, G2, G4, G12, G15, G18, G20, G22, G23, G24, G25, G27)
        if (name === `G${num}` || name === `G ${num}`) {
            return '35/gp-btnmt 15/01/2025';
        }
        
        // Pattern 2: GIẾNG + số (GIẾNG 1, GIẾNG 2, GIẾNG 4, GIẾNG 12, ...)
        if (name === `GIẾNG ${num}` || name === `GIENG ${num}` ||
            name === `GIẾNG${num}` || name === `GIENG${num}`) {
            return '35/gp-btnmt 15/01/2025';
        }
        
        // Pattern 3: GIẾNG SỐ + số (GIẾNG SỐ 1, GIẾNG SỐ 15, GIẾNG SỐ 18, ...)
        if (name === `GIẾNG SỐ ${num}` || name === `GIENG SO ${num}` ||
            name === `GIẾNG SỐ${num}` || name === `GIENG SO${num}`) {
            return '35/gp-btnmt 15/01/2025';
        }
        
        // Pattern 4: TRẠM BƠM + số (TRẠM BƠM 1, TRẠM BƠM 2, TRẠM BƠM 4, ...)
        // (Loại trừ số 21 và 26 vì đã check ở trên)
        if (num !== '21' && num !== '26') {
            if ((name === `TRẠM BƠM ${num}` || name === `TRAM BOM ${num}` ||
                 name === `TRẠM BƠM SỐ ${num}` || name === `TRAM BOM SO ${num}`) ||
                (name.includes(`TRẠM BƠM ${num}`) || name.includes(`TRAM BOM ${num}`))) {
                return '35/gp-btnmt 15/01/2025';
            }
        }
        
        // Pattern 5: Có text thêm phía sau (G1 CLO, GIẾNG 12 TẦN, GIẾNG SỐ 15 ABC, ...)
        if (name.startsWith(`G${num} `) || name.startsWith(`G ${num} `) ||
            name.startsWith(`GIẾNG ${num} `) || name.startsWith(`GIENG ${num} `) ||
            name.startsWith(`GIẾNG${num} `) || name.startsWith(`GIENG${num} `) ||
            name.startsWith(`GIẾNG SỐ ${num} `) || name.startsWith(`GIENG SO ${num} `)) {
            return '35/gp-btnmt 15/01/2025';
        }
    }
    
    // Không khớp với bất kỳ giấy phép nào
    return null;
}

/**
 * Tính công suất hoạt động theo giấy phép từ dữ liệu PostgreSQL
 */
function calculateCapacityByPermitFromDB(flowData) {
    const capacityByPermit = {};
    
    // Khởi tạo các giấy phép
    const allPermits = [
        '35/gp-btnmt 15/01/2025',
        '36/gp-btnmt 15/01/2025',
        '391/gp-bnnmt 19/09/2025',
        '393/gp-bnnmt 22/09/2025'
    ];
    
    allPermits.forEach(permit => {
        capacityByPermit[permit] = {
            permit: permit,
            totalStations: 0,
            stationsWithData: 0,
            totalCapacity: 0,
            unit: 'm³',
            stationDetails: []
        };
    });
    
    // Phân loại từng trạm theo giấy phép
    Object.keys(flowData).forEach(stationName => {
        const data = flowData[stationName];
        
        // Bỏ qua trạm quan trắc
        if (isMonitoringStation(stationName)) {
            return;
        }
        
        // Phân loại theo giấy phép
        const permit = classifyStationByName(stationName);
        
        if (!permit) {
            console.log(`   ⚠️  Không xác định được giấy phép cho: ${stationName}`);
            return;
        }
        
        console.log(`   ✓ ${stationName} → ${permit}`);
        
        // Thêm trạm vào kết quả (kể cả khi capacity = 0)
        capacityByPermit[permit].totalCapacity += data.currentMonthCapacity;
        
        if (data.currentMonthCapacity > 0 || data.lastMonthCapacity > 0) {
            capacityByPermit[permit].stationsWithData++;
        }
        
        capacityByPermit[permit].totalStations++;
        
        capacityByPermit[permit].stationDetails.push({
            stationName: stationName,
            lastMonthCapacity: data.lastMonthCapacity,
            currentMonthCapacity: data.currentMonthCapacity,
            unit: data.unit || 'm³',
            recordCount: data.recordCount,
            latestValue: data.latestValue,
            source: data.source
        });
    });
    
    // Làm tròn và sắp xếp
    Object.keys(capacityByPermit).forEach(permit => {
        capacityByPermit[permit].totalCapacity = Math.round(capacityByPermit[permit].totalCapacity * 100) / 100;
        capacityByPermit[permit].stationDetails.sort((a, b) => b.currentMonthCapacity - a.currentMonthCapacity);
    });
    
    return capacityByPermit;
}

/**
 * In kết quả công suất hoạt động
 */
function printCapacityResults(capacityByPermit) {
    console.log('\n\n═══════════════════════════════════════════════════════════════════');
    console.log('  CÔNG SUẤT HOẠT ĐỘNG THEO GIẤY PHÉP');
    console.log('  Tháng trước (đã hoàn thành) và tháng hiện tại (từ đầu tháng)');
    console.log('  Nguồn: PostgreSQL Database (TVA + MQTT + SCADA)');
    console.log('═══════════════════════════════════════════════════════════════════\n');
    
    // Tính tổng công suất
    let grandTotal = 0;
    let totalStationsWithData = 0;
    Object.values(capacityByPermit).forEach(data => {
        grandTotal += data.totalCapacity;
        totalStationsWithData += data.stationsWithData;
    });
    
    console.log(`📊 TỔNG QUAN:`);
    console.log(`   - Số giấy phép: ${Object.keys(capacityByPermit).length}`);
    console.log(`   - Tổng số trạm có dữ liệu: ${totalStationsWithData}`);
    console.log(`   - Tổng công suất: ${grandTotal.toLocaleString('vi-VN')} m³\n`);
    
    // Sắp xếp theo công suất giảm dần
    const sortedPermits = Object.keys(capacityByPermit).sort((a, b) => {
        return capacityByPermit[b].totalCapacity - capacityByPermit[a].totalCapacity;
    });
    
    sortedPermits.forEach((permit, index) => {
        const data = capacityByPermit[permit];
        const percentage = grandTotal > 0 ? ((data.totalCapacity / grandTotal) * 100).toFixed(2) : 0;
        
        console.log(`\n${'─'.repeat(67)}`);
        console.log(`📋 GIẤY PHÉP ${index + 1}: ${permit}`);
        console.log(`   Số trạm có dữ liệu: ${data.stationsWithData}`);
        console.log(`   Công suất: ${data.totalCapacity.toLocaleString('vi-VN')} ${data.unit} (${percentage}%)`);
        console.log(`${'─'.repeat(67)}`);
        
        if (data.stationDetails.length > 0) {
            data.stationDetails.forEach((station, idx) => {
                const stationPercent = data.totalCapacity > 0 
                    ? ((station.currentMonthCapacity / data.totalCapacity) * 100).toFixed(1) 
                    : 0;
                console.log(`   ${String(idx + 1).padStart(3, ' ')}. ${station.stationName} [${station.source}]`);
                console.log(`        Tháng trước: ${station.lastMonthCapacity.toLocaleString('vi-VN')} ${station.unit}`);
                console.log(`        Tháng này: ${station.currentMonthCapacity.toLocaleString('vi-VN')} ${station.unit} (${stationPercent}%)`);
                console.log(`        Số records: ${station.recordCount} | Giá trị hiện tại: ${station.latestValue.toLocaleString('vi-VN')}`);
            });
        } else {
            console.log(`   ⚠️  Không có dữ liệu "Tổng lưu lượng"`);
        }
    });
    
    console.log(`\n${'═'.repeat(67)}`);
}

/**
 * Xuất kết quả công suất ra file JSON
 */
function exportCapacityToJSON(capacityByPermit, filename = 'capacity-by-permit.json') {
    const fs = require('fs');
    
    let grandTotal = 0;
    Object.values(capacityByPermit).forEach(data => {
        grandTotal += data.totalCapacity;
    });
    
    const output = {
        exportDate: new Date().toISOString(),
        period: 'Last 30 days',
        totalPermits: Object.keys(capacityByPermit).length,
        grandTotalCapacity: grandTotal,
        unit: 'm³',
        data: capacityByPermit
    };
    
    fs.writeFileSync(filename, JSON.stringify(output, null, 2), 'utf8');
    console.log(`\n💾 Đã xuất dữ liệu công suất ra file: ${filename}`);
}

/**
 * Hàm chính
 */
async function main() {
    let pool = null;
    
    try {
        // Lấy danh sách tất cả trạm
        const stations = await fetchAllStations();
        
        if (stations.length === 0) {
            console.log('⚠️ Không tìm thấy trạm nào phù hợp');
            return;
        }
        
        console.log(`✅ Tìm thấy ${stations.length} Giếng/Trạm bơm (đã loại các trạm quan trắc)\n`);
        
        // Nhóm các trạm theo giấy phép
        const groupedStations = groupStationsByPermit(stations);
        
        // In ra kết quả danh sách trạm
        printResults(groupedStations);
        
        // Xuất ra file JSON
        exportToJSON(groupedStations);
        
        // ========== TÍNH CÔNG SUẤT HOẠT ĐỘNG TỪ POSTGRESQL ==========
        console.log('\n\n🔄 Đang kết nối PostgreSQL để tính công suất hoạt động...');
        
        // Khởi tạo kết nối database
        pool = createDatabasePool();
        
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('✅ Đã kết nối PostgreSQL');
        
        console.log(`🔍 Đang truy vấn dữ liệu "Tổng lưu lượng" từ database trong 30 ngày qua...`);
        
        // Lấy dữ liệu flow từ database (không filter theo tên)
        const flowData = await getFlowDataLast30Days(pool, null);
        
        const stationsWithData = Object.keys(flowData).length;
        console.log(`✅ Tìm thấy dữ liệu "Tổng lưu lượng" cho ${stationsWithData} trạm từ database`);
        
        // Tính công suất theo giấy phép (phân loại dựa trên tên trạm trong database)
        const capacityByPermit = calculateCapacityByPermitFromDB(flowData);
        
        // In kết quả công suất
        printCapacityResults(capacityByPermit);
        
        // Xuất ra file JSON
        exportCapacityToJSON(capacityByPermit);
        
        console.log('\n✅ Hoàn thành!\n');
        
    } catch (error) {
        console.error('\n❌ Lỗi:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Đóng kết nối database
        if (pool) {
            await pool.end();
            console.log('🔌 Đã đóng kết nối PostgreSQL');
        }
    }
}

// Chạy script
if (require.main === module) {
    main();
}

module.exports = {
    fetchAllStations,
    groupStationsByPermit,
    isMonitoringStation,
    isWellOrPumpStation,
    getPermitByProject,
    getFlowDataLast30Days,
    calculateCapacityByPermitFromDB,
    classifyStationByName,
    createDatabasePool
};
