const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TVA_STATION_COORDINATES } = require('./tva-coordinates');
const { MQTT_STATION_COORDINATES } = require('./mqtt-coordinates');
const { connectMQTT, getConnectionStatus } = require('./mqtt_client');
const { crawl: crawlTVAData } = require('./getKeyTVA');
const { 
    initDatabase, 
    saveTVAData, 
    saveMQTTData, 
    getStatsData,
    getAvailableParameters,
    getStations: getStationsFromDB,
    cleanOldData,
    checkStationsValueChanges
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware để serve static files
app.use(express.static('public'));
app.use(express.json());

// Simple authentication (in production, use proper database and hashing)
const USERS = {
    'admin': {
        password: 'admin123', // In production, use bcrypt hashed passwords
        name: 'Administrator',
        role: 'admin'
    },
    'user': {
        password: 'user123',
        name: 'User',
        role: 'user'
    }
};

// Token storage (in production, use Redis or database)
const tokens = new Map();

// Generate token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Verify token middleware
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const user = tokens.get(token);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    req.user = user;
    next();
}

/**
 * Cập nhật dữ liệu TVA từ getKeyTVA.js
 */
async function updateTVAData() {
    console.log('🔄 Đang cập nhật dữ liệu TVA...');
    
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Gọi hàm crawl trực tiếp thay vì exec
            const allStations = await crawlTVAData();
            
            if (!allStations || allStations.length === 0) {
                console.warn('⚠️ Không có dữ liệu TVA');
                return;
            }
            
            console.log(`✅ Đã lấy ${allStations.length} trạm TVA`);
            
            // Lưu dữ liệu TVA vào database
            const count = await saveTVAData(allStations);
            console.log(`💾 Đã lưu ${count} bản ghi TVA vào database`);
            
            return; // Thành công, thoát hàm
            
        } catch (error) {
            lastError = error;
            console.error(`❌ Lỗi cập nhật TVA (lần thử ${attempt}/${maxRetries}): ${error.message}`);
            
            if (attempt < maxRetries) {
                const waitTime = attempt * 2000; // 2s, 4s, 6s
                console.log(`⏳ Đợi ${waitTime/1000}s trước khi thử lại...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }
    
    // Nếu tất cả các lần thử đều thất bại
    console.error(`❌ Không thể cập nhật TVA sau ${maxRetries} lần thử`);
    throw lastError;
}

/**
 * Lưu dữ liệu MQTT từ file JSON vào database
 */
async function saveMQTTDataToDB() {
    try {
        if (!fs.existsSync('data_mqtt.json')) {
            console.warn('⚠️ Không tìm thấy file data_mqtt.json');
            return;
        }
        
        const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
        const count = await saveMQTTData(mqttData.stations);
        console.log(`💾 Đã lưu ${count} bản ghi MQTT vào database`);
    } catch (error) {
        console.error('❌ Lỗi lưu dữ liệu MQTT vào database:', error.message);
    }
}

/**
 * Authentication APIs
 */
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, message: 'Thiếu thông tin đăng nhập' });
    }
    
    const user = USERS[username];
    if (!user || user.password !== password) {
        return res.json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    
    // Generate token
    const token = generateToken();
    tokens.set(token, { 
        username, 
        name: user.name, 
        role: user.role 
    });
    
    res.json({
        success: true,
        token,
        username: user.name,
        role: user.role
    });
});

app.post('/api/logout', verifyToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        tokens.delete(token);
    }
    
    res.json({ success: true });
});

app.get('/api/verify', verifyToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// Change password endpoint
app.post('/api/change-password', verifyToken, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const username = req.user.username;
    
    if (!currentPassword || !newPassword) {
        return res.json({ success: false, message: 'Thiếu thông tin' });
    }
    
    const user = USERS[username];
    if (!user) {
        return res.json({ success: false, message: 'Người dùng không tồn tại' });
    }
    
    if (user.password !== currentPassword) {
        return res.json({ success: false, message: 'Mật khẩu hiện tại không đúng' });
    }
    
    if (newPassword.length < 6) {
        return res.json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }
    
    // Update password
    USERS[username].password = newPassword;
    
    res.json({ success: true, message: 'Đổi mật khẩu thành công' });
});

// Add user endpoint (admin only)
app.post('/api/add-user', verifyToken, (req, res) => {
    const { username, password, role } = req.body;
    
    // Check if requester is admin
    if (req.user.role !== 'admin') {
        return res.json({ success: false, message: 'Không có quyền thực hiện thao tác này' });
    }
    
    if (!username || !password || !role) {
        return res.json({ success: false, message: 'Thiếu thông tin' });
    }
    
    if (USERS[username]) {
        return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại' });
    }
    
    if (username.length < 3) {
        return res.json({ success: false, message: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
    }
    
    if (password.length < 6) {
        return res.json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự' });
    }
    
    if (role !== 'admin' && role !== 'user') {
        return res.json({ success: false, message: 'Vai trò không hợp lệ' });
    }
    
    // Add new user
    USERS[username] = {
        password,
        name: username.charAt(0).toUpperCase() + username.slice(1),
        role
    };
    
    res.json({ success: true, message: 'Thêm người dùng thành công' });
});

// Get all users endpoint (admin only)
app.get('/api/users', verifyToken, (req, res) => {
    // Check if requester is admin
    if (req.user.role !== 'admin') {
        return res.json({ success: false, message: 'Không có quyền thực hiện thao tác này' });
    }
    
    // Return list of users (without passwords)
    const userList = Object.keys(USERS).map(username => ({
        username,
        name: USERS[username].name,
        role: USERS[username].role
    }));
    
    res.json({ success: true, users: userList });
});

// Delete user endpoint (admin only)
app.post('/api/delete-user', verifyToken, (req, res) => {
    const { username } = req.body;
    
    // Check if requester is admin
    if (req.user.role !== 'admin') {
        return res.json({ success: false, message: 'Không có quyền thực hiện thao tác này' });
    }
    
    if (!username) {
        return res.json({ success: false, message: 'Thiếu thông tin' });
    }
    
    // Prevent deleting own account
    if (username === req.user.username) {
        return res.json({ success: false, message: 'Không thể xóa tài khoản của chính mình' });
    }
    
    if (!USERS[username]) {
        return res.json({ success: false, message: 'Người dùng không tồn tại' });
    }
    
    // Delete user
    delete USERS[username];
    
    // Invalidate all tokens for this user
    for (const [token, userData] of tokens.entries()) {
        if (userData.username === username) {
            tokens.delete(token);
        }
    }
    
    res.json({ success: true, message: 'Đã xóa người dùng thành công' });
});

/**
 * API: Lấy dữ liệu tất cả các trạm (TVA + MQTT)
 */
app.get('/api/stations', async (req, res) => {
    try {
        const allStations = [];
        
        // Get timeout from query parameter (default 60 minutes)
        const timeoutMinutes = parseInt(req.query.timeout) || 60;
        
        // Check which stations have value changes within timeout period
        const stationStatus = await checkStationsValueChanges(timeoutMinutes);
        
        // Đọc dữ liệu TVA
        if (fs.existsSync('data_quantrac.json')) {
            const tvaData = JSON.parse(fs.readFileSync('data_quantrac.json', 'utf8'));
            
            tvaData.stations.forEach(station => {
                const coords = TVA_STATION_COORDINATES[station.station];
                const status = stationStatus[station.station] || { hasChange: false, lastUpdate: null };
                
                // Parse updateTime từ JSON (format: "HH:mm - dd/mm/yyyy")
                let parsedUpdateTime = null;
                if (station.updateTime) {
                    const match = station.updateTime.match(/(\d{2}):(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
                    if (match) {
                        const [_, hours, minutes, day, month, year] = match;
                        parsedUpdateTime = new Date(year, month - 1, day, hours, minutes);
                    }
                }
                
                // Nếu không có dữ liệu trong DB, dùng updateTime từ JSON để kiểm tra
                let hasValueChange = status.hasChange;
                let lastUpdate = status.lastUpdate;
                
                // Nếu không có dữ liệu trong DB nhưng có updateTime từ JSON
                if (!status.lastUpdate && parsedUpdateTime) {
                    lastUpdate = parsedUpdateTime.toISOString();
                    // Kiểm tra xem updateTime có trong khoảng timeout không
                    const now = new Date();
                    const diffMinutes = (now - parsedUpdateTime) / (1000 * 60);
                    hasValueChange = diffMinutes <= timeoutMinutes;
                    console.log(`📝 TVA ${station.station}: Sử dụng updateTime từ JSON (${station.updateTime}), diffMinutes=${diffMinutes.toFixed(1)}, hasChange=${hasValueChange}`);
                }
                
                if (coords) {
                    allStations.push({
                        id: `tva_${station.station.replace(/\s+/g, '_')}`,
                        name: station.station,
                        type: 'TVA',
                        lat: coords.lat,
                        lng: coords.lng,
                        updateTime: station.updateTime,
                        lastUpdateInDB: lastUpdate,
                        hasValueChange: hasValueChange,
                        data: station.data,
                        timestamp: tvaData.timestamp
                    });
                }
            });
        }
        
        // Đọc dữ liệu MQTT
        if (fs.existsSync('data_mqtt.json')) {
            const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
            
            mqttData.stations.forEach(station => {
                const status = stationStatus[station.station] || { hasChange: false, lastUpdate: null };
                
                if (station.lat && station.lng) {
                    allStations.push({
                        id: `mqtt_${station.station.replace(/\s+/g, '_')}`,
                        name: station.station,
                        type: 'MQTT',
                        lat: station.lat,
                        lng: station.lng,
                        updateTime: station.updateTime,
                        lastUpdateInDB: status.lastUpdate,
                        hasValueChange: status.hasChange,
                        data: station.data,
                        timestamp: mqttData.timestamp
                    });
                }
            });
        }
        
        res.json({
            success: true,
            totalStations: allStations.length,
            stations: allStations,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy dữ liệu chỉ trạm TVA
 */
app.get('/api/stations/tva', (req, res) => {
    try {
        if (!fs.existsSync('data_quantrac.json')) {
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy dữ liệu TVA'
            });
        }
        
        const tvaData = JSON.parse(fs.readFileSync('data_quantrac.json', 'utf8'));
        
        const stations = tvaData.stations.map(station => {
            const coords = TVA_STATION_COORDINATES[station.station];
            return {
                id: `tva_${station.station.replace(/\s+/g, '_')}`,
                name: station.station,
                type: 'TVA',
                lat: coords?.lat,
                lng: coords?.lng,
                updateTime: station.updateTime,
                data: station.data
            };
        }).filter(s => s.lat && s.lng);
        
        res.json({
            success: true,
            totalStations: stations.length,
            stations: stations,
            timestamp: tvaData.timestamp
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy dữ liệu chỉ trạm MQTT
 */
app.get('/api/stations/mqtt', (req, res) => {
    try {
        if (!fs.existsSync('data_mqtt.json')) {
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy dữ liệu MQTT'
            });
        }
        
        const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
        
        const stations = mqttData.stations.filter(s => s.lat && s.lng).map(station => ({
            id: `mqtt_${station.station.replace(/\s+/g, '_')}`,
            name: station.station,
            type: 'MQTT',
            lat: station.lat,
            lng: station.lng,
            updateTime: station.updateTime,
            data: station.data
        }));
        
        res.json({
            success: true,
            totalStations: stations.length,
            stations: stations,
            timestamp: mqttData.timestamp
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy thông tin chi tiết một trạm
 */
app.get('/api/station/:id', (req, res) => {
    try {
        const stationId = req.params.id;
        const [type, ...nameParts] = stationId.split('_');
        
        let stationData = null;
        
        if (type === 'tva' && fs.existsSync('data_quantrac.json')) {
            const tvaData = JSON.parse(fs.readFileSync('data_quantrac.json', 'utf8'));
            const station = tvaData.stations.find(s => 
                s.station.replace(/\s+/g, '_') === nameParts.join('_')
            );
            
            if (station) {
                const coords = TVA_STATION_COORDINATES[station.station];
                stationData = {
                    id: stationId,
                    name: station.station,
                    type: 'TVA',
                    lat: coords?.lat,
                    lng: coords?.lng,
                    updateTime: station.updateTime,
                    data: station.data,
                    timestamp: tvaData.timestamp
                };
            }
        } else if (type === 'mqtt' && fs.existsSync('data_mqtt.json')) {
            const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
            const station = mqttData.stations.find(s => 
                s.station.replace(/\s+/g, '_') === nameParts.join('_')
            );
            
            if (station) {
                stationData = {
                    id: stationId,
                    name: station.station,
                    type: 'MQTT',
                    lat: station.lat,
                    lng: station.lng,
                    updateTime: station.updateTime,
                    data: station.data,
                    timestamp: mqttData.timestamp
                };
            }
        }
        
        if (stationData) {
            res.json({
                success: true,
                station: stationData
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Không tìm thấy trạm'
            });
        }
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy dữ liệu thống kê từ database
 */
app.get('/api/stats', async (req, res) => {
    try {
        const {
            stations,      // Danh sách ID trạm, phân cách bởi dấu phẩy
            type,          // 'all', 'TVA', 'MQTT'
            parameter,     // Tên thông số hoặc 'all'
            startDate,     // Ngày bắt đầu (YYYY-MM-DD)
            endDate,       // Ngày kết thúc (YYYY-MM-DD)
            limit          // Giới hạn số bản ghi
        } = req.query;

        const options = {
            stationIds: stations ? stations.split(',') : [],
            stationType: type || 'all',
            parameterName: parameter || 'all',
            startDate: startDate,
            endDate: endDate,
            limit: limit ? parseInt(limit) : 10000
        };

        const data = await getStatsData(options);
        
        res.json({
            success: true,
            totalRecords: data.length,
            data: data,
            query: options
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy danh sách các thông số có sẵn
 */
app.get('/api/stats/parameters', async (req, res) => {
    try {
        const parameters = await getAvailableParameters();
        res.json({
            success: true,
            parameters: parameters
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * API: Lấy danh sách trạm từ database
 */
app.get('/api/stats/stations', async (req, res) => {
    try {
        const stations = await getStationsFromDB();
        res.json({
            success: true,
            totalStations: stations.length,
            stations: stations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Route chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Lấy trạng thái kết nối MQTT
app.get('/api/mqtt/status', (req, res) => {
    const status = getConnectionStatus();
    res.json({
        success: true,
        ...status
    });
});

// API: Trigger manual TVA update (admin only)
app.post('/api/tva/update', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Không có quyền thực hiện thao tác này' 
        });
    }
    
    try {
        console.log(`🔄 Manual TVA update triggered by ${req.user.username}`);
        await updateTVAData();
        res.json({
            success: true,
            message: 'Đã cập nhật dữ liệu TVA thành công'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Lỗi cập nhật TVA',
            error: error.message
        });
    }
});

// Khởi động server
app.listen(PORT, async () => {
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║           WEB SERVER - HỆ THỐNG QUAN TRẮC NƯỚC CA MAU                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/stations`);
    console.log(`\n📍 Các API có sẵn:`);
    console.log(`   • GET /api/stations          - Lấy tất cả trạm (TVA + MQTT)`);
    console.log(`   • GET /api/stations/tva      - Lấy chỉ trạm TVA`);
    console.log(`   • GET /api/stations/mqtt     - Lấy chỉ trạm MQTT`);
    console.log(`   • GET /api/station/:id       - Lấy chi tiết một trạm`);
    console.log(`   • GET /api/stats             - Lấy dữ liệu thống kê từ SQL`);
    console.log(`   • GET /api/stats/parameters  - Lấy danh sách thông số`);
    console.log(`   • GET /api/stats/stations    - Lấy danh sách trạm từ SQL`);
    console.log(`   • GET /api/mqtt/status       - Trạng thái kết nối MQTT`);
    console.log(`\n💡 Mở trình duyệt và truy cập http://localhost:${PORT} để xem bản đồ`);
    console.log(`\nPress Ctrl+C để dừng server.\n`);
    
    // Khởi tạo database
    console.log('💾 Đang khởi tạo database...');
    try {
        await initDatabase();
        console.log('✅ Database đã sẵn sàng\n');
    } catch (error) {
        console.error('❌ Lỗi khởi tạo database:', error.message);
    }
    
    // Khởi động MQTT client
    console.log('🔌 Đang khởi động MQTT client...');
    try {
        await connectMQTT();
        console.log('✅ MQTT client đã kết nối\n');
    } catch (error) {
        console.error('❌ Lỗi kết nối MQTT:', error.message);
        console.log('⚠️ Server vẫn chạy nhưng không có dữ liệu MQTT realtime\n');
    }
    
    // Cập nhật dữ liệu TVA ngay khi start
    console.log('📊 Đang tải dữ liệu TVA lần đầu...');
    try {
        await updateTVAData();
    } catch (error) {
        console.error('❌ Lỗi tải dữ liệu TVA lần đầu:', error.message);
    }
    
    // Lưu dữ liệu MQTT hiện tại vào database
    console.log('📊 Đang lưu dữ liệu MQTT hiện tại...');
    await saveMQTTDataToDB();
    
    // Cập nhật dữ liệu TVA mỗi 5 phút
    setInterval(async () => {
        try {
            await updateTVAData();
        } catch (error) {
            console.error('❌ Lỗi cập nhật TVA định kỳ:', error.message);
        }
    }, 5 * 60 * 1000); // 5 phút
    
    // Lưu dữ liệu MQTT mỗi 5 phút
    setInterval(async () => {
        await saveMQTTDataToDB();
    }, 5 * 60 * 1000); // 5 phút
    
    // Dọn dẹp dữ liệu cũ mỗi ngày (giữ lại 90 ngày)
    setInterval(async () => {
        console.log('🧹 Đang dọn dẹp dữ liệu cũ...');
        try {
            await cleanOldData(90);
            console.log('✅ Đã dọn dẹp dữ liệu cũ hơn 90 ngày');
        } catch (error) {
            console.error('❌ Lỗi dọn dẹp dữ liệu:', error.message);
        }
    }, 24 * 60 * 60 * 1000); // 24 giờ
    
    console.log('🔄 Tự động lưu dữ liệu vào SQL mỗi 5 phút\n');
});

// Xử lý khi thoát
process.on('SIGINT', () => {
    console.log('\n\n🛑 Đang dừng server...');
    process.exit(0);
});
