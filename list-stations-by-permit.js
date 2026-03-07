/**
 * Module để nhóm các trạm bơm/giếng theo giấy phép
 * và tính toán công suất từ database
 */

const { Pool } = require('pg');
const config = require('./config');
const monreModule = require('./modules/monre');

// Map trạm/giếng theo giấy phép (dựa trên tên giếng/trạm)
// Bao gồm cả tên viết tắt và tên đầy đủ trong database
const STATION_PERMIT_MAPPING = {
    // Giấy phép 35: 12 trạm
    "35/gp-btnmt 15/01/2025": [
        "G1", "GIẾNG SỐ 1", "GIENG SO 1", "TRẠM BƠM 1", "TRẠM BƠM SỐ 1", "TRAM BOM 1", "TRAM BOM SO 1",
        "G2", "GIẾNG SỐ 2", "GIENG SO 2", "TRẠM BƠM 2", "TRẠM BƠM SỐ 2", "TRAM BOM 2", "TRAM BOM SO 2",
        "G4", "GIẾNG SỐ 4", "GIENG SO 4", "TRẠM BƠM 4", "TRẠM BƠM SỐ 4", "TRAM BOM 4", "TRAM BOM SO 4",
        "G12", "GIẾNG SỐ 12", "GIENG SO 12", "TRẠM BƠM 12", "TRẠM BƠM SỐ 12", "TRAM BOM 12", "TRAM BOM SO 12",
        "G15", "GIẾNG SỐ 15", "GIENG SO 15", "TRẠM BƠM 15", "TRẠM BƠM SỐ 15", "TRAM BOM 15", "TRAM BOM SO 15",
        "G18", "GIẾNG SỐ 18", "GIENG SO 18", "TRẠM BƠM 18", "TRẠM BƠM SỐ 18", "TRAM BOM 18", "TRAM BOM SO 18",
        "G20", "GIẾNG SỐ 20", "GIENG SO 20", "TRẠM BƠM 20", "TRẠM BƠM SỐ 20", "TRAM BOM 20", "TRAM BOM SO 20",
        "G22", "GIẾNG SỐ 22", "GIENG SO 22", "TRẠM BƠM 22", "TRẠM BƠM SỐ 22", "TRAM BOM 22", "TRAM BOM SO 22",
        "G23", "GIẾNG SỐ 23", "GIENG SO 23", "TRẠM BƠM 23", "TRẠM BƠM SỐ 23", "TRAM BOM 23", "TRAM BOM SO 23",
        "G24", "GIẾNG SỐ 24", "GIENG SO 24", "TRẠM BƠM 24", "TRẠM BƠM SỐ 24", "TRAM BOM 24", "TRAM BOM SO 24",
        "G25", "GIẾNG SỐ 25", "GIENG SO 25", "TRẠM BƠM 25", "TRẠM BƠM SỐ 25", "TRAM BOM 25", "TRAM BOM SO 25",
        "G27", "GIẾNG SỐ 27", "GIENG SO 27", "TRẠM BƠM 27", "TRẠM BƠM SỐ 27", "TRAM BOM 27", "TRAM BOM SO 27"
    ],
    // Giấy phép 391: 2 trạm
    "391/gp-bnnmt 19/09/2025": [
        "G21", "GIẾNG SỐ 21", "GIENG SO 21", "TRẠM BƠM 21", "TRẠM BƠM SỐ 21", "TRAM BOM 21", "TRAM BOM SO 21",
        "G26", "GIẾNG SỐ 26", "GIENG SO 26", "TRẠM BƠM 26", "TRẠM BƠM SỐ 26", "TRAM BOM 26", "TRAM BOM SO 26"
    ],
    // Giấy phép 393: 5 trạm (Nhà máy số 1)
    "393/gp-bnnmt 22/09/2025": [
        "GS1NM1", "GS1_NM1", "NHÀ MÁY SỐ 1 - GIẾNG SỐ 1", "NHA MAY SO 1 - GIENG SO 1", "GIẾNG 1 NHÀ MÁY 1", "GIENG 1 NHA MAY 1",
        "GS2NM1", "GS2_NM1", "NHÀ MÁY SỐ 1 - GIẾNG SỐ 2", "NHA MAY SO 1 - GIENG SO 2", "GIẾNG 2 NHÀ MÁY 1", "GIENG 2 NHA MAY 1",
        "GS3NM1", "GS3_NM1", "NHÀ MÁY SỐ 1 - GIẾNG SỐ 3", "NHA MAY SO 1 - GIENG SO 3", "GIẾNG 3 NHÀ MÁY 1", "GIENG 3 NHA MAY 1",
        "GS4NM1", "GS4_NM1", "NHÀ MÁY SỐ 1 - GIẾNG SỐ 4", "NHA MAY SO 1 - GIENG SO 4", "GIẾNG 4 NHÀ MÁY 1", "GIENG 4 NHA MAY 1",
        "GS5NM1", "GS5_NM1", "NHÀ MÁY SỐ 1 - GIẾNG SỐ 5", "NHA MAY SO 1 - GIENG SO 5", "GIẾNG 5 NHÀ MÁY 1", "GIENG 5 NHA MAY 1"
    ],
    // Giấy phép 36: 4 trạm (Nhà máy số 2)
    "36/gp-btnmt 15/01/2025": [
        "GS1NM2", "GS1_NM2", "NHÀ MÁY SỐ 2 - GIẾNG SỐ 1", "NHA MAY SO 2 - GIENG SO 1", "GIẾNG 1 NHÀ MÁY 2", "GIENG 1 NHA MAY 2",
        "GS2NM2", "GS2_NM2", "NHÀ MÁY SỐ 2 - GIẾNG SỐ 2", "NHA MAY SO 2 - GIENG SO 2", "GIẾNG 2 NHÀ MÁY 2", "GIENG 2 NHA MAY 2",
        "GS3NM2", "GS3_NM2", "NHÀ MÁY SỐ 2 - GIẾNG SỐ 3", "NHA MAY SO 2 - GIENG SO 3", "GIẾNG 3 NHÀ MÁY 2", "GIENG 3 NHA MAY 2",
        "GS4NM2", "GS4_NM2", "NHÀ MÁY SỐ 2 - GIẾNG SỐ 4", "NHA MAY SO 2 - GIENG SO 4", "GIẾNG 4 NHÀ MÁY 2", "GIENG 4 NHA MAY 2"
    ]
};

/**
 * Chuẩn hóa tên trạm để so sánh
 * Loại bỏ khoảng trắng, dấu gạch, dấu tiếng Việt và chuyển thành chữ hoa
 */
function normalizeStationName(name) {
    if (!name) return '';
    
    // Chuyển thành chữ hoa và loại bỏ khoảng trắng, dấu gạch, dấu chấm
    let normalized = name.trim().toUpperCase()
        .replace(/\s+/g, '')
        .replace(/_/g, '')
        .replace(/-/g, '')
        .replace(/\./g, '');
    
    // Loại bỏ dấu tiếng Việt
    normalized = normalized
        .replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A')
        .replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E')
        .replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I')
        .replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O')
        .replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U')
        .replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y')
        .replace(/Đ/g, 'D');
    
    return normalized;
}

/**
 * Tìm giấy phép dựa trên tên trạm
 * So khớp linh hoạt với nhiều biến thể tên
 * Ưu tiên khớp chuỗi dài hơn (nhà máy) trước khi khớp số đơn giản
 */
function findPermitByStationName(stationName) {
    const normalized = normalizeStationName(stationName);
    
    // Thử so khớp chính xác trước
    for (const [permit, stations] of Object.entries(STATION_PERMIT_MAPPING)) {
        for (const station of stations) {
            const normalizedStation = normalizeStationName(station);
            if (normalized === normalizedStation) {
                return permit;
            }
        }
    }
    
    // Ưu tiên khớp tên có "NHÀ MÁY" trước (dài hơn, cụ thể hơn)
    if (normalized.includes('NHAMAY')) {
        for (const [permit, stations] of Object.entries(STATION_PERMIT_MAPPING)) {
            for (const station of stations) {
                const normalizedStation = normalizeStationName(station);
                
                // Chỉ khớp với các station cũng có "NHÀ MÁY"
                if (normalizedStation.includes('NHAMAY')) {
                    if (normalized.includes(normalizedStation) || normalizedStation.includes(normalized)) {
                        return permit;
                    }
                }
            }
        }
    }
    
    // Nếu không khớp chính xác, thử so khớp một phần
    for (const [permit, stations] of Object.entries(STATION_PERMIT_MAPPING)) {
        for (const station of stations) {
            const normalizedStation = normalizeStationName(station);
            
            // Bỏ qua nếu station có "NHÀ MÁY" nhưng tên không có (đã check ở trên)
            if (normalizedStation.includes('NHAMAY') && !normalized.includes('NHAMAY')) {
                continue;
            }
            
            // So khớp nếu tên trạm chứa tên trong mapping hoặc ngược lại
            if (normalized.includes(normalizedStation) || normalizedStation.includes(normalized)) {
                // Kiểm tra thêm để tránh false positive
                // Ví dụ: "G1" không nên khớp với "G12"
                const stationNumber = normalizedStation.match(/\d+/g);
                const nameNumber = normalized.match(/\d+/g);
                
                if (stationNumber && nameNumber) {
                    // Nếu có số, phải khớp ít nhất 1 số
                    const hasMatchingNumber = stationNumber.some(num => nameNumber.includes(num));
                    if (hasMatchingNumber) {
                        return permit;
                    }
                } else {
                    return permit;
                }
            }
        }
    }
    
    return null;
}

/**
 * Lấy tất cả trạm từ MONRE API
 */
async function fetchAllStations() {
    try {
        console.log('📡 Đang lấy dữ liệu từ MONRE API...');
        const data = await monreModule.getPermitData(true); // Force refresh
        
        if (!data || data.length === 0) {
            console.log('⚠️ Không có dữ liệu từ MONRE API');
            return [];
        }
        
        // Lọc unique stations
        const stationMap = {};
        data.forEach(record => {
            const stationName = record.station;
            if (stationName && !stationMap[stationName]) {
                stationMap[stationName] = {
                    name: stationName,
                    project: record.project,
                    originalPermit: record.permit
                };
            }
        });
        
        const stations = Object.values(stationMap);
        console.log(`✅ Tìm thấy ${stations.length} trạm từ MONRE`);
        
        return stations;
    } catch (error) {
        console.error('❌ Lỗi khi lấy dữ liệu trạm:', error.message);
        return [];
    }
}

/**
 * Nhóm các trạm theo giấy phép
 */
function groupStationsByPermit(stations) {
    const grouped = {};
    
    // Khởi tạo các nhóm giấy phép
    Object.keys(STATION_PERMIT_MAPPING).forEach(permit => {
        grouped[permit] = {
            permit: permit,
            stations: [],
            stationCount: 0
        };
    });
    
    // Phân nhóm trạm theo giấy phép
    stations.forEach(station => {
        const permit = findPermitByStationName(station.name);
        
        if (permit && grouped[permit]) {
            grouped[permit].stations.push(station);
            grouped[permit].stationCount++;
        } else {
            console.log(`⚠️ Không tìm thấy giấy phép cho trạm: ${station.name}`);
        }
    });
    
    // Log kết quả
    Object.entries(grouped).forEach(([permit, data]) => {
        console.log(`📋 ${permit}: ${data.stationCount} trạm`);
    });
    
    return grouped;
}

/**
 * Tạo database pool
 */
function createDatabasePool() {
    return new Pool({
        connectionString: config.database.url,
        ssl: config.database.ssl
    });
}

/**
 * Lấy tất cả tên trạm unique từ database để debug
 */
async function getAllStationNamesFromDB(pool) {
    try {
        console.log('🔍 Đang lấy danh sách tất cả trạm từ CẢ 3 BẢNG database...');
        
        // Query từ cả 3 bảng và merge lại
        const query = `
            SELECT DISTINCT station_name, 'MQTT' as source
            FROM mqtt_data 
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
            UNION
            SELECT DISTINCT station_name, 'TVA' as source
            FROM tva_data
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
            UNION
            SELECT DISTINCT station_name, 'SCADA' as source
            FROM scada_data
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
            ORDER BY station_name
        `;
        
        const result = await pool.query(query);
        const stationNames = result.rows.map(row => row.station_name);
        
        console.log(`📋 Tìm thấy ${stationNames.length} trạm unique trong database (từ MQTT, TVA, SCADA):`);
        result.rows.forEach(row => {
            const permit = findPermitByStationName(row.station_name);
            console.log(`   - [${row.source}] ${row.station_name} ${permit ? `→ ${permit}` : '⚠️ KHÔNG KHỚP'}`);
        });
        
        return stationNames;
    } catch (error) {
        console.error('❌ Lỗi lấy danh sách trạm:', error.message);
        return [];
    }
}

/**
 * Lấy dữ liệu lưu lượng từ database (30 ngày gần nhất)
 * Query từ CẢ 3 BẢNG: mqtt_data, tva_data, scada_data
 * Trả về: { stationName: [{ measurementTime, value, unit, ... }] }
 * 
 * QUAN TRỌNG: Đồng bộ timezone khi truy vấn
 * - Set session timezone = 'Asia/Ho_Chi_Minh'
 * - Chuyển created_at về GMT+7 khi query
 * - PostgreSQL TIMESTAMPTZ tự động chuyển đổi theo session timezone
 */
async function getFlowDataLast30Days(pool, stationNames = null) {
    try {
        // Set timezone cho session này về GMT+7
        await pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        // Tính 30 ngày trước theo timezone Việt Nam
        const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
        
        console.log('🔍 Đang truy vấn dữ liệu "Tổng lưu lượng" từ CẢ 3 BẢNG...');
        console.log(`📅 Từ ngày: ${thirtyDaysAgo.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
        
        // Query UNION từ cả 3 bảng
        // QUAN TRỌNG: Sử dụng AT TIME ZONE để đảm bảo chuyển đổi đúng
        let unionQuery = `
            SELECT 
                station_name,
                parameter_name,
                value,
                unit,
                created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at,
                'MQTT' as source
            FROM mqtt_data
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
                AND created_at >= $1
            
            UNION ALL
            
            SELECT 
                station_name,
                parameter_name,
                value,
                unit,
                created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at,
                'TVA' as source
            FROM tva_data
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
                AND created_at >= $1
            
            UNION ALL
            
            SELECT 
                station_name,
                parameter_name,
                value,
                unit,
                created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as created_at,
                'SCADA' as source
            FROM scada_data
            WHERE parameter_name ILIKE '%tổng lưu lượng%'
                AND created_at >= $1
            
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(unionQuery, [thirtyDaysAgo]);
        
        console.log(`📊 Query trả về ${result.rows.length} records từ cả 3 bảng`);
        
        // Organize data by station
        const flowData = {};
        const sourceCounts = { MQTT: 0, TVA: 0, SCADA: 0 };
        
        result.rows.forEach(row => {
            const stationName = row.station_name;
            if (!flowData[stationName]) {
                flowData[stationName] = [];
            }
            flowData[stationName].push({
                measurementTime: new Date(row.created_at).toISOString(),
                value: parseFloat(row.value) || 0,
                unit: row.unit || 'm³',
                parameter: row.parameter_name,
                source: row.source
            });
            sourceCounts[row.source]++;
        });
        
        console.log(`✅ Tìm thấy dữ liệu lưu lượng cho ${Object.keys(flowData).length} trạm`);
        console.log(`   📡 MQTT: ${sourceCounts.MQTT} records`);
        console.log(`   📡 TVA: ${sourceCounts.TVA} records`);
        console.log(`   📡 SCADA: ${sourceCounts.SCADA} records`);
        
        return flowData;
    } catch (error) {
        console.error('❌ Lỗi truy vấn database:', error.message);
        console.error('Stack:', error.stack);
        return {};
    }
}

/**
 * Tính công suất theo giấy phép từ dữ liệu database
 * 
 * QUAN TRỌNG: Đồng bộ timezone để tính toán đúng
 * - Tạo ranh giới tháng theo GMT+7
 * - So sánh timestamp đã được chuẩn hóa về GMT+7 từ query
 */
function calculateCapacityByPermitFromDB(flowData) {
    const capacityByPermit = {};
    
    // Hàm helper: Tạo Date theo timezone Việt Nam
    function createVietnamDate(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
        // Tạo date string theo format ISO với timezone GMT+7
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}+07:00`;
        return new Date(dateStr);
    }
    
    // Get current time in Vietnam timezone (GMT+7)
    const now = new Date();
    const vietnamNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const currentYear = vietnamNow.getFullYear();
    const currentMonth = vietnamNow.getMonth() + 1; // 1-12
    const currentDay = vietnamNow.getDate();
    
    // Last month boundaries (theo GMT+7)
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthDays = new Date(lastMonthYear, lastMonth, 0).getDate();
    
    const lastMonthStart = createVietnamDate(lastMonthYear, lastMonth, 1, 0, 0, 0, 0);
    const lastMonthEnd = createVietnamDate(lastMonthYear, lastMonth, lastMonthDays, 23, 59, 59, 999);
    
    // Current month boundaries (theo GMT+7)
    const currentMonthStart = createVietnamDate(currentYear, currentMonth, 1, 0, 0, 0, 0);
    const currentMonthEnd = now; // Thời điểm hiện tại
    
    // Yesterday boundaries (theo GMT+7)
    const yesterdayDate = new Date(vietnamNow);
    yesterdayDate.setDate(currentDay - 1);
    const yesterdayYear = yesterdayDate.getFullYear();
    const yesterdayMonth = yesterdayDate.getMonth() + 1;
    const yesterdayDay = yesterdayDate.getDate();
    const yesterdayStart = createVietnamDate(yesterdayYear, yesterdayMonth, yesterdayDay, 0, 0, 0, 0);
    const yesterdayEnd = createVietnamDate(yesterdayYear, yesterdayMonth, yesterdayDay, 23, 59, 59, 999);
    
    // Today boundaries (theo GMT+7)
    const todayStart = createVietnamDate(currentYear, currentMonth, currentDay, 0, 0, 0, 0);
    const todayEnd = now;
    
    console.log(`📅 Tháng trước (GMT+7): ${lastMonthStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} - ${lastMonthEnd.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    console.log(`📅 Tháng hiện tại (GMT+7): ${currentMonthStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} - ${currentMonthEnd.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    console.log(`📅 Hôm qua (GMT+7): ${yesterdayStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} - ${yesterdayEnd.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    console.log(`📅 Hôm nay (GMT+7): ${todayStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} - ${todayEnd.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
    
    // Initialize permit groups
    Object.keys(STATION_PERMIT_MAPPING).forEach(permit => {
        capacityByPermit[permit] = {
            permit: permit,
            lastMonthCapacity: 0,
            currentMonthCapacity: 0,
            totalCapacity: 0,
            stationDetails: [],
            stationsWithData: 0
        };
    });
    
    // Process each station in flow data
    for (const [stationName, records] of Object.entries(flowData)) {
        const permit = findPermitByStationName(stationName);
        
        if (!permit || !capacityByPermit[permit]) {
            console.log(`⚠️ Bỏ qua trạm không thuộc giấy phép nào: ${stationName}`);
            continue;
        }
        
        let lastMonthMax = 0;
        let currentMonthMax = 0;
        let lastMonthRecords = 0;
        let currentMonthRecords = 0;
        let previousDayMax = 0;
        let previousDayMin = Infinity;
        let todayMax = 0;
        let todayMin = Infinity;
        let dayBeforeYesterdayMax = 0;
        
        // Day before yesterday boundaries (for calculating yesterday's capacity)
        const dayBeforeYesterday = new Date(yesterdayDate);
        dayBeforeYesterday.setDate(yesterdayDate.getDate() - 1);
        const dayBeforeYear = dayBeforeYesterday.getFullYear();
        const dayBeforeMonth = dayBeforeYesterday.getMonth() + 1;
        const dayBeforeDay = dayBeforeYesterday.getDate();
        const dayBeforeStart = createVietnamDate(dayBeforeYear, dayBeforeMonth, dayBeforeDay, 0, 0, 0, 0);
        const dayBeforeEnd = createVietnamDate(dayBeforeYear, dayBeforeMonth, dayBeforeDay, 23, 59, 59, 999);
        
        // Process records for this station
        records.forEach(record => {
            // measurementTime đã được chuyển về GMT+7 từ query (có AT TIME ZONE)
            const recordTime = new Date(record.measurementTime);
            const value = parseFloat(record.value) || 0;
            
            // Check if in last month
            // So sánh theo timestamp đã chuẩn hóa
            if (recordTime >= lastMonthStart && recordTime <= lastMonthEnd) {
                lastMonthMax = Math.max(lastMonthMax, value);
                lastMonthRecords++;
            }
            
            // Check if in current month
            if (recordTime >= currentMonthStart && recordTime <= currentMonthEnd) {
                currentMonthMax = Math.max(currentMonthMax, value);
                currentMonthRecords++;
            }
            
            // Check if day before yesterday
            if (recordTime >= dayBeforeStart && recordTime <= dayBeforeEnd) {
                dayBeforeYesterdayMax = Math.max(dayBeforeYesterdayMax, value);
            }
            
            // Check if yesterday
            if (recordTime >= yesterdayStart && recordTime <= yesterdayEnd) {
                previousDayMax = Math.max(previousDayMax, value);
                previousDayMin = Math.min(previousDayMin, value);
            }
            
            // Check if today
            if (recordTime >= todayStart && recordTime <= todayEnd) {
                todayMax = Math.max(todayMax, value);
                todayMin = Math.min(todayMin, value);
            }
        });
        
        // Calculate daily capacity as difference (for cumulative meters)
        // Yesterday's capacity = max value at end of yesterday - max value at end of day before
        // Today's capacity = max value at end of today - max value at end of yesterday
        let yesterdayCapacity = 0;
        let todayCapacity = 0;
        
        if (previousDayMax > 0) {
            // If we have data for day before yesterday, calculate difference
            if (dayBeforeYesterdayMax > 0) {
                yesterdayCapacity = previousDayMax - dayBeforeYesterdayMax;
            } else {
                // Otherwise use the range within yesterday
                yesterdayCapacity = previousDayMax - (previousDayMin === Infinity ? 0 : previousDayMin);
            }
        }
        
        if (todayMax > 0) {
            // Calculate today's capacity as difference from yesterday's max
            if (previousDayMax > 0) {
                todayCapacity = todayMax - previousDayMax;
            } else {
                // If no yesterday data, use today's range
                todayCapacity = todayMax - (todayMin === Infinity ? 0 : todayMin);
            }
        }
        
        // Ensure non-negative values
        yesterdayCapacity = Math.max(0, yesterdayCapacity);
        todayCapacity = Math.max(0, todayCapacity);
        
        // Add to permit totals
        capacityByPermit[permit].lastMonthCapacity += lastMonthMax;
        capacityByPermit[permit].currentMonthCapacity += currentMonthMax;
        capacityByPermit[permit].totalCapacity += currentMonthMax;
        
        if (lastMonthRecords > 0 || currentMonthRecords > 0) {
            capacityByPermit[permit].stationsWithData++;
        }
        
        // Add station details
        capacityByPermit[permit].stationDetails.push({
            stationName: stationName,
            lastMonthCapacity: lastMonthMax,
            currentMonthCapacity: currentMonthMax,
            previousDayCapacity: yesterdayCapacity,  // Daily consumption for yesterday
            todayCapacity: todayCapacity,  // Daily consumption for today
            unit: records[0]?.unit || 'm³',
            recordCount: records.length,
            lastMonthRecords: lastMonthRecords,
            currentMonthRecords: currentMonthRecords,
            source: records[0]?.source || 'MQTT'
        });
        
        console.log(`  📍 ${stationName}: Tháng trước=${lastMonthMax.toFixed(2)}m³ (${lastMonthRecords} records), Tháng nay=${currentMonthMax.toFixed(2)}m³ (${currentMonthRecords} records), Hôm qua=${yesterdayCapacity.toFixed(2)}m³, Hôm nay=${todayCapacity.toFixed(2)}m³`);
    }
    
    // Log summary
    Object.entries(capacityByPermit).forEach(([permit, data]) => {
        console.log(`📊 ${permit}: ${data.stationsWithData} trạm có dữ liệu, Tổng tháng nay: ${data.currentMonthCapacity.toFixed(2)} m³`);
    });
    
    return capacityByPermit;
}

module.exports = {
    STATION_PERMIT_MAPPING,
    normalizeStationName,
    findPermitByStationName,
    fetchAllStations,
    groupStationsByPermit,
    createDatabasePool,
    getAllStationNamesFromDB,
    getFlowDataLast30Days,
    calculateCapacityByPermitFromDB
};
