const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Import configuration
const config = require('./config');

// Import coordinates
const { TVA_STATION_COORDINATES } = require('./tva-coordinates');
const { MQTT_STATION_COORDINATES } = require('./mqtt-coordinates');
const { SCADA_STATION_COORDINATES } = require('./scada-coordinates');

// Import modules
const mqttModule = require('./modules/mqtt');
const tvaModule = require('./modules/tva');
const scadaModule = require('./modules/scada');
const dbModule = require('./modules/database');

const app = express();
const PORT = config.server.port;

// Middleware để serve static files
app.use(express.static('public'));
app.use(express.json());

// Simple authentication (from config)
const USERS = config.auth.users;

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || config.auth.jwtSecret || 'camau-water-monitoring-secret-key-2026';
const JWT_EXPIRES_IN = '7d'; // Token hết hạn sau 7 ngày

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { 
            username: user.username, 
            name: user.name, 
            role: user.role 
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

// Verify JWT token middleware
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired' });
        }
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

/**
 * Cập nhật dữ liệu TVA từ module TVA
 */
async function updateTVAData() {
    console.log('🔄 Đang cập nhật dữ liệu TVA...');
    
    try {
        const allStations = await tvaModule.getTVADataWithRetry();
        
        if (!allStations || allStations.length === 0) {
            console.warn('⚠️ Không có dữ liệu TVA');
            return;
        }
        
        console.log(`✅ Đã lấy ${allStations.length} trạm TVA`);
        
        // Lưu dữ liệu TVA vào database
        const count = await dbModule.saveTVAData(allStations);
        console.log(`💾 Đã lưu ${count} bản ghi TVA vào database`);
        
    } catch (error) {
        console.error(`❌ Lỗi cập nhật TVA:`, error.message);
        throw error;
    }
}

/**
 * Lưu dữ liệu MQTT từ module MQTT vào database
 */
async function saveMQTTDataToDB() {
    try {
        const mqttData = mqttModule.getStationsData();
        
        if (!mqttData || !mqttData.stations || mqttData.stations.length === 0) {
            console.warn('⚠️ Không có dữ liệu MQTT để lưu');
            return;
        }
        
        const count = await dbModule.saveMQTTData(mqttData.stations);
        console.log(`💾 Đã lưu ${count} bản ghi MQTT vào database`);
    } catch (error) {
        console.error('❌ Lỗi lưu dữ liệu MQTT vào database:', error.message);
    }
}

/**
 * Helper function: Tìm coordinates thông minh
 * Thử tìm theo nhiều cách: exact match, station ID, normalize name
 */
function findCoordinates(stationName, coordinatesMap) {
    // 1. Tìm trực tiếp
    if (coordinatesMap[stationName]) {
        return coordinatesMap[stationName];
    }
    
    // 2. Tìm theo station ID (từ station name)
    // Ví dụ: "GIẾNG 4 NHÀ MÁY 2" => tìm "G4_NM2"
    const stationIdPatterns = [
        // Extract station ID from full name
        { regex: /GIẾNG (\d+) NHÀ MÁY (\d+)/i, format: (m) => `G${m[1]}_NM${m[2]}` },
        { regex: /TRẠM BƠM SỐ (\d+)/i, format: (m) => `TRAM_${m[1]}` },
        { regex: /TRẠM (\d+)/i, format: (m) => `TRAM_${m[1]}` },
        // Handle station IDs directly
        { regex: /^(G\d+[AB]?)$/i, format: (m) => m[1].toUpperCase() },
        { regex: /^(QT\d+[A-Z]?)(_NM\d+)?$/i, format: (m) => (m[1] + (m[2] || '')).toUpperCase() },
        { regex: /^(GS\d+)_NM(\d+)$/i, format: (m) => `${m[1]}_NM${m[2]}`.toUpperCase() }
    ];
    
    for (const pattern of stationIdPatterns) {
        const match = stationName.match(pattern.regex);
        if (match) {
            const stationId = pattern.format(match);
            if (coordinatesMap[stationId]) {
                return coordinatesMap[stationId];
            }
        }
    }
    
    // 3. Tìm case-insensitive
    const lowerName = stationName.toLowerCase();
    for (const key in coordinatesMap) {
        if (key.toLowerCase() === lowerName) {
            return coordinatesMap[key];
        }
    }
    
    // 4. Không tìm thấy
    return null;
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
    
    // Generate JWT token
    const token = generateToken({ username, name: user.name, role: user.role });
    
    res.json({
        success: true,
        token,
        username: user.name,
        role: user.role
    });
});

app.post('/api/logout', verifyToken, (req, res) => {
    // With JWT, no need to delete token from server
    // Token will expire automatically based on JWT_EXPIRES_IN
    // Client just needs to remove token from localStorage
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
    
    // Note: With JWT, existing tokens will remain valid until expiry
    // For immediate revocation, consider using token blacklist or shorter expiry
    
    res.json({ success: true, message: 'Đã xóa người dùng thành công' });
});

// ============================================
// VISITOR TRACKING API
// ============================================
// Visitor tracking sử dụng PostgreSQL database
// currentVisitors và todayVisitors vẫn dùng RAM để tính real-time online users
// totalVisitors lưu trong database để không bị reset khi restart
// Helper function to get current date in Vietnam timezone
function getCurrentDateVietnam() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(new Date()); // Returns YYYY-MM-DD format
}

const visitorStats = {
    currentVisitors: new Map(), // sessionId -> { timestamp, page } (online users)
    todayVisitors: new Set(),   // Set of session IDs for today (unique visitors today)
    lastResetDate: getCurrentDateVietnam()
};

// Clean up stale visitor sessions (older than 5 minutes)
function cleanupStaleVisitors() {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [sessionId, data] of visitorStats.currentVisitors.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
            visitorStats.currentVisitors.delete(sessionId);
        }
    }
}

// Reset daily stats at midnight (Vietnam timezone GMT+7)
function checkDailyReset() {
    const today = getCurrentDateVietnam();
    if (visitorStats.lastResetDate !== today) {
        console.log(`🔄 Resetting daily visitor count: ${visitorStats.lastResetDate} -> ${today}`);
        visitorStats.todayVisitors.clear();
        visitorStats.lastResetDate = today;
    }
}

// Run cleanup every minute
setInterval(() => {
    cleanupStaleVisitors();
    checkDailyReset();
}, 60000);

// Register a new visit
app.post('/api/visitors/register', async (req, res) => {
    try {
        const { page, timestamp } = req.body;
        
        // Generate or get session ID from header
        let sessionId = req.headers['x-session-id'] || crypto.randomBytes(16).toString('hex');
        
        // Update current visitors (online users)
        visitorStats.currentVisitors.set(sessionId, {
            timestamp: Date.now(),
            page: page || '/'
        });
        
        // Check if this is a new visitor today
        let dbStats;
        if (!visitorStats.todayVisitors.has(sessionId)) {
            visitorStats.todayVisitors.add(sessionId);
            // Increment in database
            dbStats = await dbModule.incrementVisitorCount();
        } else {
            // Just get current stats from database
            dbStats = await dbModule.getVisitorStats();
        }
        
        res.json({
            success: true,
            sessionId: sessionId,
            stats: {
                currentVisitors: visitorStats.currentVisitors.size,
                todayVisitors: visitorStats.todayVisitors.size,
                totalVisitors: dbStats.total_visitors
            }
        });
    } catch (error) {
        console.error('Error registering visit:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get current visitor statistics
app.get('/api/visitors/stats', async (req, res) => {
    try {
        cleanupStaleVisitors();
        checkDailyReset();
        
        // Get total visitors from database
        const dbStats = await dbModule.getVisitorStats();
        
        // Sync todayVisitors with database if available
        const todayFromDB = dbStats.today_visitors || 0;
        const todayFromRAM = visitorStats.todayVisitors.size;
        
        // Use the larger value to avoid inconsistency
        const todayVisitors = Math.max(todayFromDB, todayFromRAM);
        
        res.json({
            success: true,
            currentVisitors: visitorStats.currentVisitors.size,
            todayVisitors: todayVisitors,  // Sync with database
            totalVisitors: dbStats.total_visitors
        });
    } catch (error) {
        console.error('Error getting visitor stats:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Handle page unload (visitor leaving)
app.post('/api/visitors/unload', (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        if (sessionId && visitorStats.currentVisitors.has(sessionId)) {
            visitorStats.currentVisitors.delete(sessionId);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error handling unload:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * API: Lấy dữ liệu tất cả các trạm (TVA + MQTT + SCADA)
 */
app.get('/api/stations', async (req, res) => {
    try {
        const allStations = [];
        
        // Get timeout from query parameter or use config default
        const timeoutMinutes = parseInt(req.query.timeout) || config.station.timeoutMinutes;
        
        console.log(`🔍 Checking station status with timeout: ${timeoutMinutes} minutes`);
        
        // Check which stations have value changes within timeout period
        const stationStatus = await dbModule.checkStationsValueChanges(timeoutMinutes);
        
        // Get latest data from database (ưu tiên)
        const dbStationsData = await dbModule.getLatestStationsData();
        
        // Count online/offline
        let onlineCount = 0;
        let offlineCount = 0;
        
        // Đọc dữ liệu TVA từ database trước, fallback sang file JSON nếu không có
        const tvaStationsInDB = Object.keys(dbStationsData).filter(name => 
            dbStationsData[name].type === 'TVA'
        );
        
        if (tvaStationsInDB.length > 0) {
            console.log(`📊 Loading ${tvaStationsInDB.length} TVA stations from database`);
            tvaStationsInDB.forEach(stationName => {
                const dbStation = dbStationsData[stationName];
                const coords = TVA_STATION_COORDINATES[stationName];
                const status = stationStatus[stationName] || { 
                    status: 'offline', 
                    hasChange: false, 
                    lastUpdate: null,
                    timeSinceUpdate: null
                };
                
                if (coords) {
                    allStations.push({
                        id: `tva_${stationName.replace(/\s+/g, '_')}`,
                        name: stationName,
                        type: 'TVA',
                        lat: coords.lat,
                        lng: coords.lng,
                        status: status.status,              // 'online' hoặc 'offline'
                        updateTime: dbStation.updateTime,
                        lastUpdateInDB: dbStation.timestamp,
                        timeSinceUpdate: status.timeSinceUpdate, // Số phút kể từ lần cập nhật cuối
                        hasValueChange: status.hasChange,    // Giữ lại để tương thích ngược
                        data: dbStation.data,
                        timestamp: dbStation.timestamp
                    });
                    
                    if (status.status === 'online') onlineCount++;
                    else offlineCount++;
                }
            });
        } else if (fs.existsSync('data_quantrac.json')) {
            // Fallback: Đọc từ file JSON nếu không có dữ liệu trong DB
            console.log('⚠️ No TVA data in DB, loading from JSON file');
            const tvaData = JSON.parse(fs.readFileSync('data_quantrac.json', 'utf8'));
            
            tvaData.stations.forEach(station => {
                const coords = TVA_STATION_COORDINATES[station.station];
                const status = stationStatus[station.station] || { 
                    status: 'offline', 
                    hasChange: false, 
                    lastUpdate: null,
                    timeSinceUpdate: null 
                };
                
                // Parse updateTime từ JSON (format: "HH:mm - dd/mm/yyyy")
                let parsedUpdateTime = null;
                if (station.updateTime) {
                    const match = station.updateTime.match(/(\d{2}):(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
                    if (match) {
                        const [_, hours, minutes, day, month, year] = match;
                        parsedUpdateTime = new Date(year, month - 1, day, hours, minutes);
                    }
                }
                
                let stationStatusValue = status.status;
                let lastUpdate = status.lastUpdate;
                let timeSinceUpdate = status.timeSinceUpdate;
                
                if (!status.lastUpdate && parsedUpdateTime) {
                    lastUpdate = parsedUpdateTime.toISOString();
                    const now = new Date();
                    const diffMinutes = Math.floor((now - parsedUpdateTime) / (1000 * 60));
                    timeSinceUpdate = diffMinutes;
                    stationStatusValue = diffMinutes <= timeoutMinutes ? 'online' : 'offline';
                }
                
                if (coords) {
                    allStations.push({
                        id: `tva_${station.station.replace(/\s+/g, '_')}`,
                        name: station.station,
                        type: 'TVA',
                        lat: coords.lat,
                        lng: coords.lng,
                        status: stationStatusValue,
                        updateTime: station.updateTime,
                        lastUpdateInDB: lastUpdate,
                        timeSinceUpdate: timeSinceUpdate,
                        hasValueChange: stationStatusValue === 'online',
                        data: station.data,
                        timestamp: tvaData.timestamp
                    });
                    
                    if (stationStatusValue === 'online') onlineCount++;
                    else offlineCount++;
                }
            });
        }
        
        // Đọc dữ liệu MQTT từ database trước
        const mqttStationsInDB = Object.keys(dbStationsData).filter(name => 
            dbStationsData[name].type === 'MQTT'
        );
        
        if (mqttStationsInDB.length > 0) {
            console.log(`📊 Loading ${mqttStationsInDB.length} MQTT stations from database`);
            mqttStationsInDB.forEach(stationName => {
                const dbStation = dbStationsData[stationName];
                const status = stationStatus[stationName] || { 
                    status: 'offline', 
                    hasChange: false, 
                    lastUpdate: null,
                    timeSinceUpdate: null
                };
                
                // Get coordinates using smart lookup
                const coords = findCoordinates(stationName, MQTT_STATION_COORDINATES);
                
                if (coords) {
                    allStations.push({
                        id: `mqtt_${stationName.replace(/\s+/g, '_')}`,
                        name: stationName,
                        type: 'MQTT',
                        lat: coords.lat,
                        lng: coords.lng,
                        status: status.status,
                        updateTime: dbStation.updateTime,
                        lastUpdateInDB: dbStation.timestamp,
                        timeSinceUpdate: status.timeSinceUpdate,
                        hasValueChange: status.hasChange,
                        data: dbStation.data,
                        timestamp: dbStation.timestamp
                    });
                    console.log(`   ✅ MQTT station added: ${stationName} (${coords.lat}, ${coords.lng}) - ${status.status}`);
                    
                    if (status.status === 'online') onlineCount++;
                    else offlineCount++;
                } else {
                    console.warn(`   ⚠️ No coordinates found for MQTT station: ${stationName}`);
                }
            });
        } else if (fs.existsSync('data_mqtt.json')) {
            // Fallback: Đọc từ file JSON
            console.log('⚠️ No MQTT data in DB, loading from JSON file');
            const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
            
            mqttData.stations.forEach(station => {
                const status = stationStatus[station.station] || { 
                    status: 'offline', 
                    hasChange: false, 
                    lastUpdate: null,
                    timeSinceUpdate: null
                };
                
                if (station.lat && station.lng) {
                    allStations.push({
                        id: `mqtt_${station.station.replace(/\s+/g, '_')}`,
                        name: station.station,
                        type: 'MQTT',
                        lat: station.lat,
                        lng: station.lng,
                        status: status.status,
                        updateTime: station.updateTime,
                        lastUpdateInDB: status.lastUpdate,
                        timeSinceUpdate: status.timeSinceUpdate,
                        hasValueChange: status.hasChange,
                        data: station.data,
                        timestamp: mqttData.timestamp
                    });
                    
                    if (status.status === 'online') onlineCount++;
                    else offlineCount++;
                }
            });
        }
        
        // Đọc dữ liệu SCADA (chất lượng nước) từ database
        const scadaStationsInDB = Object.keys(dbStationsData).filter(name => 
            dbStationsData[name].type === 'SCADA'
        );
        
        if (scadaStationsInDB.length > 0) {
            console.log(`📊 Loading ${scadaStationsInDB.length} SCADA stations from database`);
            scadaStationsInDB.forEach(stationName => {
                const dbStation = dbStationsData[stationName];
                const status = stationStatus[stationName] || { 
                    status: 'offline', 
                    hasChange: false, 
                    lastUpdate: null,
                    timeSinceUpdate: null
                };
                
                // Get coordinates using smart lookup
                const coords = findCoordinates(stationName, SCADA_STATION_COORDINATES);
                
                if (coords) {
                    allStations.push({
                        id: `scada_${stationName.replace(/\s+/g, '_')}`,
                        name: stationName,
                        type: 'SCADA',
                        lat: coords.lat,
                        lng: coords.lng,
                        status: status.status,
                        updateTime: dbStation.updateTime,
                        lastUpdateInDB: dbStation.timestamp,
                        timeSinceUpdate: status.timeSinceUpdate,
                        hasValueChange: status.hasChange,
                        data: dbStation.data,
                        timestamp: dbStation.timestamp
                    });
                    console.log(`   ✅ SCADA station added: ${stationName} (${coords.lat}, ${coords.lng}) - ${status.status}`);
                    
                    if (status.status === 'online') onlineCount++;
                    else offlineCount++;
                } else {
                    console.warn(`   ⚠️ No coordinates found for SCADA station: ${stationName}`);
                }
            });
        } else if (fs.existsSync('data_scada_tva.json')) {
            // Fallback: Đọc từ file JSON
            console.log('⚠️ No SCADA data in DB, loading from JSON file');
            const scadaData = JSON.parse(fs.readFileSync('data_scada_tva.json', 'utf8'));
            
            if (scadaData.stationsGrouped) {
                Object.keys(scadaData.stationsGrouped).forEach(stationName => {
                    const station = scadaData.stationsGrouped[stationName];
                    const coords = SCADA_STATION_COORDINATES[stationName];
                    const status = stationStatus[stationName] || { 
                        status: 'offline', 
                        hasChange: false, 
                        lastUpdate: null,
                        timeSinceUpdate: null
                    };
                    
                    if (coords) {
                        allStations.push({
                            id: `scada_${stationName.replace(/\s+/g, '_')}`,
                            name: stationName,
                            type: 'SCADA',
                            lat: coords.lat,
                            lng: coords.lng,
                            status: status.status,
                            updateTime: station.updateTime,
                            lastUpdateInDB: status.lastUpdate,
                            timeSinceUpdate: status.timeSinceUpdate,
                            hasValueChange: status.hasChange,
                            data: station.data,
                            timestamp: scadaData.timestamp
                        });
                        
                        if (status.status === 'online') onlineCount++;
                        else offlineCount++;
                    }
                });
            }
        }
        
        // Deduplication: Loại bỏ các trạm trùng lặp dựa trên tọa độ giống nhau
        // Ưu tiên: TVA > MQTT > SCADA (nếu cùng tọa độ)
        const deduplicatedStations = [];
        const seenCoordinates = new Map(); // key: "lat,lng", value: station
        
        allStations.forEach(station => {
            const coordKey = `${station.lat.toFixed(6)},${station.lng.toFixed(6)}`;
            
            if (!seenCoordinates.has(coordKey)) {
                // Chưa có trạm nào ở tọa độ này
                seenCoordinates.set(coordKey, station);
                deduplicatedStations.push(station);
            } else {
                // Đã có trạm ở tọa độ này - kiểm tra ưu tiên
                const existing = seenCoordinates.get(coordKey);
                const typePriority = { 'TVA': 3, 'MQTT': 2, 'SCADA': 1 };
                
                // Nếu trạm mới có priority cao hơn, thay thế
                if (typePriority[station.type] > typePriority[existing.type]) {
                    console.log(`   🔄 Duplicate detected: Replacing ${existing.name} (${existing.type}) with ${station.name} (${station.type}) at ${coordKey}`);
                    const index = deduplicatedStations.findIndex(s => s.id === existing.id);
                    if (index !== -1) {
                        deduplicatedStations[index] = station;
                        seenCoordinates.set(coordKey, station);
                        
                        // Cập nhật count
                        if (existing.status === 'online') onlineCount--;
                        else offlineCount--;
                        if (station.status === 'online') onlineCount++;
                        else offlineCount++;
                    }
                } else {
                    console.log(`   ⚠️  Duplicate ignored: ${station.name} (${station.type}) at same location as ${existing.name} (${existing.type}) - ${coordKey}`);
                }
            }
        });
        
        const duplicatesRemoved = allStations.length - deduplicatedStations.length;
        
        console.log(`📊 ===== STATION STATUS SUMMARY =====`);
        console.log(`   🟢 Online:  ${onlineCount} stations`);
        console.log(`   🔴 Offline: ${offlineCount} stations`);
        console.log(`   📍 Total:   ${deduplicatedStations.length} stations`);
        if (duplicatesRemoved > 0) {
            console.log(`   🗑️  Removed: ${duplicatesRemoved} duplicates`);
        }
        console.log(`   ⏱️  Timeout: ${timeoutMinutes} minutes`);
        console.log(`===================================`);
        
        res.json({
            success: true,
            totalStations: deduplicatedStations.length,
            onlineStations: onlineCount,
            offlineStations: offlineCount,
            duplicatesRemoved: duplicatesRemoved,
            timeoutMinutes: timeoutMinutes,
            stations: deduplicatedStations,
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
            type,          // 'all', 'TVA', 'MQTT', 'SCADA'
            parameter,     // Tên thông số hoặc 'all'
            startDate,     // Ngày bắt đầu (YYYY-MM-DD)
            endDate,       // Ngày kết thúc (YYYY-MM-DD)
            interval,      // Khoảng lấy mẫu (phút)
            limit          // Giới hạn số bản ghi
        } = req.query;

        const options = {
            stationIds: stations ? stations.split(',') : [],
            stationType: type || 'all',
            parameterName: parameter || 'all',
            startDate: startDate,
            endDate: endDate,
            interval: interval ? parseInt(interval) : 60,
            limit: limit ? parseInt(limit) : 10000
        };

        console.log('📊 Stats API called with options:', options);
        
        const data = await dbModule.getStatsData(options);
        
        console.log(`📊 Stats API returning ${data.length} records`);
        
        res.json({
            success: true,
            totalRecords: data.length,
            data: data,
            query: options
        });
    } catch (error) {
        console.error('❌ Stats API error:', error);
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
        const parameters = await dbModule.getAvailableParameters();
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
        const stations = await dbModule.getStations();
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

// ==================== SCADA TVA API ====================

// API: Lấy dữ liệu từ hệ thống SCADA TVA
app.get('/api/scada/stations', async (req, res) => {
    try {
        console.log("📡 [API] Yêu cầu lấy dữ liệu từ SCADA TVA");
        const stations = await crawlScadaTVA();
        
        // Lưu dữ liệu vào SQL database
        try {
            // Đọc file JSON để lấy stationsGrouped
            const dataPath = path.join(__dirname, 'data_scada_tva.json');
            if (fs.existsSync(dataPath)) {
                const scadaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                if (scadaData.stationsGrouped) {
                    const savedCount = await saveSCADAData(scadaData.stationsGrouped);
                    console.log(`💾 [SQL] Đã lưu ${savedCount} bản ghi SCADA vào database`);
                }
            }
        } catch (saveError) {
            console.error("⚠️ [SQL] Lỗi khi lưu dữ liệu SCADA vào database:", saveError.message);
            // Không throw lỗi, vẫn trả về dữ liệu đã crawl
        }
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            count: stations.length,
            data: stations
        });
    } catch (error) {
        console.error("❌ [API] Lỗi lấy dữ liệu SCADA:", error.message);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy dữ liệu từ hệ thống SCADA',
            error: error.message
        });
    }
});

// API: Lấy chi tiết một trạm từ SCADA
app.get('/api/scada/station/:id', async (req, res) => {
    try {
        const stationId = req.params.id;
        console.log(`📡 [API] Lấy chi tiết trạm SCADA: ${stationId}`);
        
        const stationDetail = await getStationDetail(stationId);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: stationDetail
        });
    } catch (error) {
        console.error(`❌ [API] Lỗi lấy chi tiết trạm ${req.params.id}:`, error.message);
        res.status(500).json({
            success: false,
            message: 'Lỗi khi lấy chi tiết trạm',
            error: error.message
        });
    }
});

// API: Cập nhật dữ liệu SCADA (chỉ admin)
app.post('/api/scada/update', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ 
            success: false, 
            message: 'Không có quyền thực hiện thao tác này' 
        });
    }
    
    try {
        console.log(`🔄 Manual SCADA update triggered by ${req.user.username}`);
        const stations = await crawlScadaTVA();
        
        // Lưu dữ liệu vào SQL database
        try {
            const dataPath = path.join(__dirname, 'data_scada_tva.json');
            if (fs.existsSync(dataPath)) {
                const scadaData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
                if (scadaData.stationsGrouped) {
                    const savedCount = await saveSCADAData(scadaData.stationsGrouped);
                    console.log(`💾 [SQL] Đã lưu ${savedCount} bản ghi SCADA vào database`);
                }
            }
        } catch (saveError) {
            console.error("⚠️ [SQL] Lỗi khi lưu dữ liệu SCADA vào database:", saveError.message);
        }
        
        res.json({
            success: true,
            message: 'Đã cập nhật dữ liệu SCADA thành công',
            count: stations.length
        });
    } catch (error) {
        console.error("❌ [API] Lỗi cập nhật SCADA:", error.message);
        res.status(500).json({
            success: false,
            message: 'Lỗi cập nhật dữ liệu SCADA',
            error: error.message
        });
    }
});

// API: Lấy dữ liệu SCADA đã cache (từ database SQL)
app.get('/api/scada/cached', async (req, res) => {
    try {
        // Query dữ liệu SCADA mới nhất từ database
        const result = await dbModule.pool.query(`
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                created_at
            FROM scada_data
            ORDER BY station_name, parameter_name, created_at DESC
        `);
        
        // Group data by station
        const stationsGrouped = {};
        let latestTimestamp = null;
        
        for (const row of result.rows) {
            const stationId = row.station_id.replace('scada_', '');
            
            if (!stationsGrouped[stationId]) {
                stationsGrouped[stationId] = {
                    station: stationId,
                    stationName: row.station_name,
                    group: row.station_name,
                    parameters: []
                };
            }
            
            stationsGrouped[stationId].parameters.push({
                parameter: row.parameter_name,
                parameterName: row.parameter_name,
                value: parseFloat(row.value) || 0,
                displayText: row.value !== null ? String(row.value) : '--',
                unit: row.unit || '',
                created_at: row.created_at
            });
            
            // Track the most recent timestamp
            if (!latestTimestamp || new Date(row.created_at) > new Date(latestTimestamp)) {
                latestTimestamp = row.created_at;
            }
        }
        
        // If we have data from database, return it
        if (Object.keys(stationsGrouped).length > 0) {
            console.log(`✅ [API] Trả về ${Object.keys(stationsGrouped).length} trạm SCADA từ database`);
            return res.json({
                success: true,
                timestamp: latestTimestamp || new Date().toISOString(),
                created_at: latestTimestamp || new Date().toISOString(),
                source: 'PostgreSQL Database',
                method: 'SQL Query - Latest Data',
                stationsGrouped: stationsGrouped,
                totalStations: Object.keys(stationsGrouped).length
            });
        }
        
        // Fallback: try to read from file cache
        console.log('⚠️ [API] Không có dữ liệu SCADA trong database, thử đọc từ file cache');
        const dataPath = path.join(__dirname, 'data_scada_tva.json');
        
        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({
                success: false,
                message: 'Chưa có dữ liệu. Hệ thống sẽ cập nhật dữ liệu trong 5 phút tới.'
            });
        }
        
        const cachedData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        
        res.json({
            success: true,
            ...cachedData,
            source: cachedData.source || 'File Cache',
            method: cachedData.method || 'Cached'
        });
    } catch (error) {
        console.error("❌ [API] Lỗi đọc dữ liệu SCADA:", error.message);
        res.status(500).json({
            success: false,
            message: 'Lỗi đọc dữ liệu SCADA',
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
    console.log(`\n📊 API Thống kê:`);
    console.log(`   • GET /api/stats             - Lấy dữ liệu thống kê từ SQL`);
    console.log(`   • GET /api/stats/parameters  - Lấy danh sách thông số`);
    console.log(`   • GET /api/stats/stations    - Lấy danh sách trạm từ SQL`);
    console.log(`\n🏭 API SCADA TVA (Mới):`);
    console.log(`   • GET  /api/scada/stations   - Lấy dữ liệu realtime từ SCADA`);
    console.log(`   • GET  /api/scada/station/:id- Chi tiết trạm SCADA`);
    console.log(`   • GET  /api/scada/cached     - Lấy dữ liệu SCADA đã cache`);
    console.log(`   • POST /api/scada/update     - Cập nhật dữ liệu SCADA (admin)`);
    console.log(`\n🔌 API Khác:`);
    console.log(`   • GET /api/mqtt/status       - Trạng thái kết nối MQTT`);
    console.log(`\n💡 Mở trình duyệt và truy cập http://localhost:${PORT} để xem bản đồ`);
    console.log(`\nPress Ctrl+C để dừng server.\n`);
    
    // Khởi tạo database
    console.log('💾 Đang khởi tạo database...');
    try {
        await dbModule.initDatabase();
        console.log('✅ Database đã sẵn sàng\n');
    } catch (error) {
        console.error('❌ Lỗi khởi tạo database:', error.message);
    }
    
    // Khởi động MQTT client
    console.log('🔌 Đang khởi động MQTT client...');
    try {
        await mqttModule.connectMQTT();
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
    
    // Cập nhật dữ liệu SCADA TVA lần đầu
    console.log('📊 Đang tải dữ liệu SCADA lần đầu...');
    try {
        const stations = await scadaModule.crawlScadaTVA();
        console.log(`✅ Đã lấy dữ liệu SCADA: ${stations.length} trạm`);
        
        // Lưu vào database
        const scadaPath = path.join(__dirname, 'data_scada_tva.json');
        if (fs.existsSync(scadaPath)) {
            const scadaData = JSON.parse(fs.readFileSync(scadaPath, 'utf-8'));
            if (scadaData.stationsGrouped) {
                const savedCount = await dbModule.saveSCADAData(scadaData.stationsGrouped);
                console.log(`✅ Đã lưu ${savedCount} bản ghi SCADA vào database\n`);
            }
        }
    } catch (error) {
        console.error('❌ Lỗi tải dữ liệu SCADA lần đầu:', error.message);
    }
    
    // Cập nhật dữ liệu TVA mỗi 5 phút
    setInterval(async () => {
        try {
            await updateTVAData();
        } catch (error) {
            console.error('❌ Lỗi cập nhật TVA định kỳ:', error.message);
        }
    }, config.intervals.tva);
    
    // Lưu dữ liệu MQTT mỗi 1 phút
    setInterval(async () => {
        await saveMQTTDataToDB();
    }, config.intervals.mqtt);
    
    // Cập nhật SCADA mỗi 5 phút
    setInterval(async () => {
        try {
            console.log('🔄 Đang crawl dữ liệu SCADA TVA...');
            const stations = await scadaModule.crawlScadaTVA();
            
            const scadaPath = path.join(__dirname, 'data_scada_tva.json');
            if (fs.existsSync(scadaPath)) {
                const scadaData = JSON.parse(fs.readFileSync(scadaPath, 'utf-8'));
                if (scadaData.stationsGrouped) {
                    const savedCount = await dbModule.saveSCADAData(scadaData.stationsGrouped);
                    console.log(`✅ [SCADA] Đã lưu ${savedCount} bản ghi vào database`);
                }
            }
        } catch (error) {
            console.error('❌ Lỗi cập nhật SCADA định kỳ:', error.message);
        }
    }, config.intervals.scada);
    
    // Dọn dẹp dữ liệu cũ mỗi ngày (giữ lại 90 ngày)
    setInterval(async () => {
        console.log('🧹 Đang dọn dẹp dữ liệu cũ...');
        try {
            await dbModule.cleanOldData(90);
            console.log('✅ Đã dọn dẹp dữ liệu cũ hơn 90 ngày');
        } catch (error) {
            console.error('❌ Lỗi dọn dẹp dữ liệu:', error.message);
        }
    }, config.intervals.cleanup);
    
    console.log('🔄 Tự động lưu dữ liệu vào SQL mỗi 5 phút\n');
});

// Xử lý khi thoát
process.on('SIGINT', () => {
    console.log('\n\n🛑 Đang dừng server...');
    process.exit(0);
});
