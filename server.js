require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// Import configuration
const config = require('./config');

// Telegram config file path — use persistent disk on Render, fallback to project root locally
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TELEGRAM_CONFIG_FILE = path.join(DATA_DIR, 'telegram-config.json');

// Log DATA_DIR location for debugging
console.log('📂 DATA_DIR for telegram config:', DATA_DIR);
if (process.env.NODE_ENV === 'production' && !process.env.DATA_DIR) {
    console.warn('⚠️  CẢNH BÁO: DATA_DIR chưa được set! Config telegram sẽ bị mất khi restart.');
    console.warn('   → Vui lòng mount persistent disk và set DATA_DIR=/var/data trong Render');
}

// Load Telegram config from file
function loadTelegramConfig() {
    try {
        console.log('📥 Loading telegram config from:', TELEGRAM_CONFIG_FILE);
        if (fs.existsSync(TELEGRAM_CONFIG_FILE)) {
            const data = fs.readFileSync(TELEGRAM_CONFIG_FILE, 'utf8');
            const savedConfig = JSON.parse(data);
            
            // Backward compatibility: convert old field name to new one
            if (savedConfig.alertCooldown !== undefined && savedConfig.alertRepeatInterval === undefined) {
                savedConfig.alertRepeatInterval = savedConfig.alertCooldown;
                delete savedConfig.alertCooldown;
                console.log('⚠️ Converted alertCooldown to alertRepeatInterval for backward compatibility');
            }

            // Don't overwrite a bot token set via env var with an empty string from the file
            if (!savedConfig.botToken && config.telegram.botToken) {
                delete savedConfig.botToken;
            }

            // Merge saved config with default config
            config.telegram = { ...config.telegram, ...savedConfig };
            console.log('✅ Loaded Telegram config:', { ...config.telegram, botToken: config.telegram.botToken ? '***set***' : '(empty)' });
        } else {
            console.log('ℹ️ No saved Telegram config found, using defaults');
            // Auto-enable if bot token and chat ID are set via environment variables
            if (config.telegram.botToken && config.telegram.chatId && !config.telegram.enabled) {
                config.telegram.enabled = true;
                console.log('✅ Auto-enabled Telegram alerts (bot token & chat ID set via env vars)');
                saveTelegramConfig();
            }
        }
    } catch (error) {
        console.error('❌ Error loading Telegram config:', error.message);
    }
}

// Save Telegram config to file
function saveTelegramConfig() {
    try {
        const configToSave = {
            enabled: config.telegram.enabled,
            botToken: config.telegram.botToken || '',
            chatId: config.telegram.chatId,
            refreshInterval: config.telegram.refreshInterval || 15,
            delayThreshold: config.telegram.delayThreshold || 60,
            alertRepeatInterval: config.telegram.alertRepeatInterval || 60,
            alertMinutes: config.telegram.alertMinutes || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
        };
        fs.writeFileSync(TELEGRAM_CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf8');
        console.log('💾 Saved Telegram config to file');
        return true;
    } catch (error) {
        console.error('❌ Error saving Telegram config:', error.message);
        return false;
    }
}

// Load Telegram config on startup
loadTelegramConfig();

// Coordinate overrides (admin can update via API, persisted in PostgreSQL)
let coordinatesOverride = {};

/**
 * Load coordinate overrides from PostgreSQL into memory cache.
 * Called once at startup and after each write.
 */
async function reloadCoordinatesOverride() {
    try {
        coordinatesOverride = await dbModule.loadCoordinateOverrides();
        console.log(`✅ Loaded ${Object.keys(coordinatesOverride).length} coordinate overrides from DB`);
    } catch (e) {
        console.error('❌ reloadCoordinatesOverride:', e.message);
    }
}

// Import coordinates
const { TVA_STATION_COORDINATES } = require('./tva-coordinates');
const { MQTT_STATION_COORDINATES } = require('./mqtt-coordinates');
const { SCADA_STATION_COORDINATES } = require('./scada-coordinates');

// Import modules
const mqttModule = require('./modules/mqtt');
const tvaModule = require('./modules/tva');
const scadaModule = require('./modules/scada');
const dbModule = require('./modules/database');
const monreModule = require('./modules/monre');

const app = express();
const PORT = config.server.port;

// Trigger Telegram alert check on ANY incoming request (including static-file pings from cron-job.org).
// This ensures alerts fire even when cron pings /databtn.html instead of /health.
// Rate-limited to at most once per minute.
app.use((req, res, next) => {
    if (config.telegram && config.telegram.enabled &&
        config.telegram.botToken && config.telegram.chatId) {
        if (Date.now() - lastTelegramCheckTime >= 55 * 1000) {
            checkAndSendTelegramAlerts().catch(err =>
                console.error('❌ [REQUEST] Telegram check error:', err.message)
            );
        }
    }
    next();
});

// Middleware để serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Disable caching for API responses so dashboards always receive fresh data.
app.use('/api', (req, res, next) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store'
    });
    next();
});

// Simple authentication (from config)
const USERS = config.auth.users;

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || config.auth.jwtSecret || 'camau-water-monitoring-secret-key-2026';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
    console.warn('⚠️  CẢNH BÁO: JWT_SECRET chưa được đặt qua biến môi trường. Hãy đặt JWT_SECRET trong Render dashboard để bảo mật!');
}
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
// MONRE PERMIT DATA API
// ============================================

// Get permit data from MONRE IoT
app.get('/api/permit-data', verifyToken, async (req, res) => {
    try {
        const data = await monreModule.getPermitData();
        res.json({ 
            success: true, 
            data: data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching permit data:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể lấy dữ liệu từ MONRE IoT',
            error: error.message 
        });
    }
});

// Force refresh permit data
app.post('/api/permit-data/refresh', verifyToken, async (req, res) => {
    try {
        const data = await monreModule.getPermitData(true);
        res.json({ 
            success: true, 
            data: data,
            timestamp: new Date().toISOString(),
            message: 'Đã làm mới dữ liệu thành công'
        });
    } catch (error) {
        console.error('Error refreshing permit data:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể làm mới dữ liệu',
            error: error.message 
        });
    }
});

// Get station history data (30 latest records)
app.get('/api/station-history/:stationName', verifyToken, async (req, res) => {
    try {
        const { stationName } = req.params;
        const { days = 30 } = req.query; // Allow custom days param, default 30
        
        if (!stationName) {
            return res.status(400).json({ 
                success: false, 
                message: 'Thiếu tên trạm' 
            });
        }
        
        const decodedStationName = decodeURIComponent(stationName);
        const numDays = parseInt(days) || 30;
        
        // Get history from MONRE API (all records within date range)
        const historyData = await monreModule.getStationHistory(decodedStationName, numDays);
        
        res.json({
            success: true,
            stationName: decodedStationName,
            days: numDays,
            totalRecords: historyData.length,
            data: historyData
        });
    } catch (error) {
        console.error('Error fetching station history:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể lấy dữ liệu lịch sử',
            error: error.message 
        });
    }
});

// ============================================
// PERMIT CAPACITY API
// ============================================

function normalizeStationNameForMatch(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function isSoTaiNguyenWell(stationName) {
    const n = normalizeStationNameForMatch(stationName);
    const targets = [
        'GIENG SO 29A',
        'GIENG SO 30A',
        'GIENG SO 31B',
        'GIENG TAC VAN',
        'TRAM BOM 16'
    ];
    return targets.some(target => n === target || n.includes(target));
}

function isDKGStation(stationName) {
    const n = String(stationName || '').trim().toUpperCase();
    // Check if station name starts with "DKG"
    return n.startsWith('DKG');
}

function createVietnamBoundary(year, month, day, hour = 0, minute = 0, second = 0, ms = 0) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}+07:00`;
    return new Date(dateStr);
}

function calculateCapacityForStationRecords(records) {
    const now = new Date();
    const vietnamNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const currentYear = vietnamNow.getFullYear();
    const currentMonth = vietnamNow.getMonth() + 1;
    const currentDay = vietnamNow.getDate();

    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthDays = new Date(lastMonthYear, lastMonth, 0).getDate();

    const lastMonthStart = createVietnamBoundary(lastMonthYear, lastMonth, 1, 0, 0, 0, 0);
    const lastMonthEnd = createVietnamBoundary(lastMonthYear, lastMonth, lastMonthDays, 23, 59, 59, 999);
    const currentMonthStart = createVietnamBoundary(currentYear, currentMonth, 1, 0, 0, 0, 0);

    const yesterdayDate = new Date(vietnamNow);
    yesterdayDate.setDate(currentDay - 1);
    const yesterdayStart = createVietnamBoundary(
        yesterdayDate.getFullYear(),
        yesterdayDate.getMonth() + 1,
        yesterdayDate.getDate(),
        0, 0, 0, 0
    );
    const yesterdayEnd = createVietnamBoundary(
        yesterdayDate.getFullYear(),
        yesterdayDate.getMonth() + 1,
        yesterdayDate.getDate(),
        23, 59, 59, 999
    );

    const dayBeforeYesterday = new Date(yesterdayDate);
    dayBeforeYesterday.setDate(yesterdayDate.getDate() - 1);
    const dayBeforeStart = createVietnamBoundary(
        dayBeforeYesterday.getFullYear(),
        dayBeforeYesterday.getMonth() + 1,
        dayBeforeYesterday.getDate(),
        0, 0, 0, 0
    );
    const dayBeforeEnd = createVietnamBoundary(
        dayBeforeYesterday.getFullYear(),
        dayBeforeYesterday.getMonth() + 1,
        dayBeforeYesterday.getDate(),
        23, 59, 59, 999
    );

    const todayStart = createVietnamBoundary(currentYear, currentMonth, currentDay, 0, 0, 0, 0);

    let lastMonthMin = Infinity;
    let lastMonthMax = 0;
    let currentMonthMin = Infinity;
    let currentMonthMax = 0;
    let yesterdayMax = 0;
    let yesterdayMin = Infinity;
    let dayBeforeYesterdayMax = 0;
    let todayMax = 0;
    let todayMin = Infinity;

    records.forEach(record => {
        const recordTime = new Date(record.measurementTime);
        if (Number.isNaN(recordTime.getTime())) return;
        const value = Number(record.value) || 0;

        if (recordTime >= lastMonthStart && recordTime <= lastMonthEnd) {
            lastMonthMax = Math.max(lastMonthMax, value);
            lastMonthMin = Math.min(lastMonthMin, value);
        }

        if (recordTime >= currentMonthStart && recordTime <= now) {
            currentMonthMax = Math.max(currentMonthMax, value);
            currentMonthMin = Math.min(currentMonthMin, value);
        }

        if (recordTime >= dayBeforeStart && recordTime <= dayBeforeEnd) {
            dayBeforeYesterdayMax = Math.max(dayBeforeYesterdayMax, value);
        }

        if (recordTime >= yesterdayStart && recordTime <= yesterdayEnd) {
            yesterdayMax = Math.max(yesterdayMax, value);
            yesterdayMin = Math.min(yesterdayMin, value);
        }

        if (recordTime >= todayStart && recordTime <= now) {
            todayMax = Math.max(todayMax, value);
            todayMin = Math.min(todayMin, value);
        }
    });

    const lastMonthCapacity = lastMonthMax > 0 && lastMonthMin !== Infinity
        ? Math.max(0, lastMonthMax - lastMonthMin)
        : 0;

    const currentMonthCapacity = currentMonthMax > 0 && currentMonthMin !== Infinity
        ? Math.max(0, currentMonthMax - currentMonthMin)
        : 0;

    const previousDayCapacity = yesterdayMax > 0
        ? Math.max(0, yesterdayMax - (dayBeforeYesterdayMax > 0 ? dayBeforeYesterdayMax : (yesterdayMin === Infinity ? 0 : yesterdayMin)))
        : 0;

    const todayCapacity = todayMax > 0
        ? Math.max(0, todayMax - (yesterdayMax > 0 ? yesterdayMax : (todayMin === Infinity ? 0 : todayMin)))
        : 0;

    return {
        monthlyCapacity: Math.round(lastMonthCapacity * 100) / 100,
        currentCapacity: Math.round(currentMonthCapacity * 100) / 100,
        previousDayCapacity: Math.round(previousDayCapacity * 100) / 100,
        todayCapacity: Math.round(todayCapacity * 100) / 100
    };
}

// Get permit capacity data (stations grouped by permit with capacity calculations)
app.get('/api/permit-capacity', verifyToken, async (req, res) => {
    try {
        console.log('📊 Fetching permit capacity data...');
        
        // Import the functions from list-stations-by-permit.js
        const permitModule = require('./list-stations-by-permit');
        
        // Check if database pool is ready
        if (!dbModule.pool) {
            console.error('❌ Database pool not initialized');
            return res.status(503).json({
                success: false,
                message: 'Database chưa sẵn sàng. Vui lòng thử lại sau.'
            });
        }
        
        // Test database connection
        try {
            await dbModule.pool.query('SELECT NOW()');
            console.log('✅ Database connection OK');
        } catch (dbError) {
            console.error('❌ Database connection failed:', dbError.message);
            return res.status(503).json({
                success: false,
                message: 'Không thể kết nối database: ' + dbError.message
            });
        }
        
        // SKIP MONRE API call - not reliable from Render
        // Instead, rely on database queries which will find all stations with flow data
        console.log('ℹ️ Skipping MONRE API call, using database stations only');
        
        // Get flow data from database (last 30 days)
        // This will automatically discover all stations that have flow data
        console.log('🔍 Đang truy vấn dữ liệu "Tổng lưu lượng" từ database...');
        const flowData = await permitModule.getFlowDataLast30Days(dbModule.pool, null);
        
        const stationsWithData = Object.keys(flowData).length;
        console.log(`✅ Tìm thấy dữ liệu cho ${stationsWithData} trạm từ database`);
        
        // Calculate capacity from flow data
        const capacityByPermit = permitModule.calculateCapacityByPermitFromDB(flowData);
        
        // Calculate grand total and flatten data for table view
        let grandTotalCapacity = 0;
        const tableData = [];
        let rowNumber = 1;
        let totalStationsWithData = 0;
        
        // Sort permits for consistent display
        const sortedPermits = ['35/gp-btnmt 15/01/2025', '36/gp-btnmt 15/01/2025', '391/gp-bnnmt 19/09/2025', '393/gp-bnnmt 22/09/2025'];
        
        sortedPermits.forEach(permitNumber => {
            const permitData = capacityByPermit[permitNumber];
            if (!permitData) return;
            
            grandTotalCapacity += permitData.totalCapacity;
            totalStationsWithData += permitData.stationsWithData;
            
            // Add each station as a row in the table
            permitData.stationDetails.forEach(station => {
                tableData.push({
                    stt: rowNumber++,
                    stationName: station.stationName,
                    permit: permitNumber,
                    monthlyCapacity: Math.round(station.lastMonthCapacity * 100) / 100, // Tháng trước đã hoàn thành
                    currentCapacity: Math.round(station.currentMonthCapacity * 100) / 100, // Tháng hiện tại (từ đầu tháng đến nay)
                    previousDayCapacity: Math.round(station.previousDayCapacity * 100) / 100, // Ngày hôm qua
                    todayCapacity: Math.round(station.todayCapacity * 100) / 100, // Ngày hôm nay
                    unit: station.unit || 'm³',
                    recordCount: station.recordCount,
                    source: station.source
                });
            });
        });

        // Add outside-permit wells (Sở Tài nguyên) from SQL data
        const outsidePermitWells = [];
        Object.entries(flowData)
            .filter(([stationName]) => isSoTaiNguyenWell(stationName))
            .sort((a, b) => a[0].localeCompare(b[0], 'vi'))
            .forEach(([stationName, records]) => {
                const calc = calculateCapacityForStationRecords(records || []);
                const lastRecord = Array.isArray(records) && records.length > 0 ? records[0] : null;

                outsidePermitWells.push({
                    stt: rowNumber++,
                    stationName,
                    permit: 'so-tai-nguyen',
                    monthlyCapacity: calc.monthlyCapacity,
                    currentCapacity: calc.currentCapacity,
                    previousDayCapacity: calc.previousDayCapacity,
                    todayCapacity: calc.todayCapacity,
                    unit: lastRecord?.unit || 'm³',
                    recordCount: Array.isArray(records) ? records.length : 0,
                    source: Array.isArray(records)
                        ? [...new Set(records.map(r => r.source).filter(Boolean))].join(', ')
                        : ''
                });
            });
        
        console.log(`📊 Kết quả: ${totalStationsWithData} trạm có dữ liệu thuộc ${Object.keys(capacityByPermit).length} giấy phép`);
        console.log(`📊 Giếng Sở tài nguyên: ${outsidePermitWells.length} trạm`);
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            totalStations: totalStationsWithData, // Số trạm thực tế có dữ liệu
            totalPermits: Object.keys(capacityByPermit).length,
            grandTotalCapacity: Math.round(grandTotalCapacity * 100) / 100,
            tableData: tableData,
            outsidePermitWells,
            data: capacityByPermit // Keep original format for reference
        });
    } catch (error) {
        console.error('❌ Error fetching permit capacity:', error.message);
        console.error(error.stack);
        res.status(500).json({
            success: false,
            message: 'Không thể lấy dữ liệu công suất giấy phép',
            error: error.message
        });
    }
});

/**
 * GET /api/station-daily-capacity/:stationName
 * Returns daily capacity (m³/day) for a station in a given month.
 * Query params: year, month (1-12)
 */
app.get('/api/station-daily-capacity/:stationName', verifyToken, async (req, res) => {
    try {
        const stationName = decodeURIComponent(req.params.stationName);
        const year  = parseInt(req.query.year)  || new Date().getFullYear();
        const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

        if (month < 1 || month > 12 || year < 2000 || year > 2100) {
            return res.status(400).json({ success: false, message: 'Tháng/năm không hợp lệ' });
        }

        if (!dbModule.pool) {
            return res.status(503).json({ success: false, message: 'Database chưa sẵn sàng' });
        }

        await dbModule.pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");

        const daysInMonth = new Date(year, month, 0).getDate();

        // Include the day immediately before the month to compute day-1 capacity
        const prevMonthYear  = month === 1 ? year - 1 : year;
        const prevMonth      = month === 1 ? 12 : month - 1;
        const prevMonthDays  = new Date(prevMonthYear, prevMonth, 0).getDate();

        const startTs = new Date(`${prevMonthYear}-${String(prevMonth).padStart(2,'0')}-${String(prevMonthDays).padStart(2,'0')}T00:00:00+07:00`);
        const endTs   = new Date(`${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}T23:59:59+07:00`);

        // Max "Tổng lưu lượng" per calendar day (VN timezone) across all 3 tables
        const queryText = `
            SELECT
                DATE(ts AT TIME ZONE 'Asia/Ho_Chi_Minh') AS day,
                MAX(CAST(val AS NUMERIC))                 AS max_value,
                unit
            FROM (
                SELECT timestamp AS ts, value AS val, unit FROM mqtt_data
                 WHERE parameter_name ILIKE '%tổng lưu lượng%'
                   AND station_name = $1 AND timestamp >= $2 AND timestamp <= $3
                UNION ALL
                SELECT timestamp, value, unit FROM tva_data
                 WHERE parameter_name ILIKE '%tổng lưu lượng%'
                   AND station_name = $1 AND timestamp >= $2 AND timestamp <= $3
                UNION ALL
                SELECT timestamp, value, unit FROM scada_data
                 WHERE parameter_name ILIKE '%tổng lưu lượng%'
                   AND station_name = $1 AND timestamp >= $2 AND timestamp <= $3
            ) combined
            GROUP BY DATE(ts AT TIME ZONE 'Asia/Ho_Chi_Minh'), unit
            ORDER BY day ASC
        `;

        const result = await dbModule.pool.query(queryText, [stationName, startTs.toISOString(), endTs.toISOString()]);

        // Build date → max_value map
        const dailyMap = {};
        let unit = 'm³';
        result.rows.forEach(row => {
            const dayStr = (row.day instanceof Date ? row.day.toISOString() : String(row.day)).substring(0, 10);
            dailyMap[dayStr] = parseFloat(row.max_value) || 0;
            if (row.unit) unit = row.unit;
        });

        // Previous day's key (last day of previous month)
        const prevDayKey = `${prevMonthYear}-${String(prevMonth).padStart(2,'0')}-${String(prevMonthDays).padStart(2,'0')}`;

        const dailyCapacity = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const todayKey = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const yesterdayKey = d === 1
                ? prevDayKey
                : `${year}-${String(month).padStart(2,'0')}-${String(d-1).padStart(2,'0')}`;

            const todayMax = dailyMap[todayKey]     || 0;
            const prevMax  = dailyMap[yesterdayKey] || 0;

            let capacity = 0;
            if (todayMax > 0 && prevMax > 0 && todayMax > prevMax) {
                capacity = todayMax - prevMax;
            }

            dailyCapacity.push({
                day: d,
                date: todayKey,
                capacity: Math.round(capacity * 100) / 100
            });
        }

        res.json({ success: true, stationName, year, month, unit, dailyCapacity });
    } catch (err) {
        console.error('❌ Error fetching station daily capacity:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + err.message });
    }
});

// ============================================
// TELEGRAM ALERT API
// ============================================

// Send Telegram alert
app.post('/api/telegram/alert', verifyToken, async (req, res) => {
    try {
        const { station, status, measurementTime, permit } = req.body;
        
        if (!station || !status) {
            return res.status(400).json({ 
                success: false, 
                message: 'Thiếu thông tin trạm hoặc trạng thái' 
            });
        }
        
        // Check if Telegram is enabled and chat ID is configured
        if (!config.telegram.enabled || !config.telegram.chatId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Telegram chưa được cấu hình hoặc chưa bật' 
            });
        }
        
        // Validate bot token format (Telegram bot tokens have format: number:alphanumeric)
        if (!config.telegram.botToken || !config.telegram.botToken.includes(':')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Bot token không hợp lệ. Vui lòng cấu hình Bot Token đúng định dạng từ @BotFather' 
            });
        }
        
        const stationStatus = {
            status,
            permit: permit || null,
            measurementMs: measurementTime ? Date.parse(measurementTime) : null,
            measurementTime
        };
        const message = `📡 Chưa gửi dữ liệu: ${status === 'offline' ? '1/1' : '0/1'}\n${buildStationLine(1, station, stationStatus)}`;

        const response = await sendServerTelegramMessage(message);

        if (response.ok) {
            res.json({ 
                success: true, 
                message: 'Đã gửi cảnh báo thành công' 
            });
        } else {
            throw new Error('Telegram API trả về lỗi');
        }
        
    } catch (error) {
        console.error('Error sending Telegram alert:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể gửi cảnh báo',
            error: error.message 
        });
    }
});

// Test Telegram connection (send a test message)
app.post('/api/telegram/test', verifyToken, async (req, res) => {
    try {
        const { chatId, botToken } = req.body;
        
        const effectiveBotToken = botToken && String(botToken).trim() !== ''
            ? String(botToken).trim()
            : config.telegram.botToken;

        // Validate bot token format first
        if (!effectiveBotToken || !effectiveBotToken.includes(':')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Bot token không hợp lệ. Vui lòng nhập Bot Token đúng định dạng từ @BotFather (format: 1234567890:ABCdef...)' 
            });
        }
        
        // Use provided chatId or use configured one
        const targetChatId = chatId || config.telegram.chatId;
        
        if (!targetChatId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vui lòng cung cấp Chat ID để test' 
            });
        }
        
        // Format test message
        const message = `🧪 TEST CẢNH BÁO TELEGRAM\n\n📡 Chưa gửi dữ liệu: 1/1\n1. TEST_STATION -GP_TEST. Lúc: ${formatAlertTime(Date.now())}`;

        console.log(`📤 Sending test message to chat ID: ${targetChatId}`);

        const result = await sendTelegramMessageWithFallback(targetChatId, message, effectiveBotToken);

        if (result.data.ok) {
            console.log('✅ Test message sent successfully');
            res.json({ 
                success: true, 
                message: result.migrated
                    ? `Đã gửi tin nhắn test thành công và tự cập nhật Chat ID mới: ${result.chatId}`
                    : 'Đã gửi tin nhắn test thành công! Kiểm tra Telegram của bạn.',
                data: {
                    chatId: result.chatId,
                    messageId: result.data.result.message_id,
                    migrated: result.migrated
                }
            });
        } else {
            throw new Error('Telegram API trả về lỗi');
        }
        
    } catch (error) {
        console.error('❌ Error sending test message:', error.message);
        
        // Provide more detailed error message
        let errorMsg = 'Không thể gửi tin nhắn test';
        if (error.response?.data?.description) {
            errorMsg += ': ' + error.response.data.description;
        } else if (error.message) {
            errorMsg += ': ' + error.message;
        }
        
        res.status(500).json({ 
            success: false, 
            message: errorMsg,
            error: error.response?.data || error.message 
        });
    }
});

// Proxy getUpdates (returns chat IDs without exposing bot token to frontend)
app.get('/api/telegram/getupdates', verifyToken, async (req, res) => {
    try {
        if (!config.telegram.botToken || !config.telegram.botToken.includes(':')) {
            return res.status(400).json({ 
                success: false, 
                message: 'Bot token chưa được cấu hình hoặc không hợp lệ. Vui lòng nhập Bot Token từ @BotFather' 
            });
        }
        const url = `https://api.telegram.org/bot${config.telegram.botToken}/getUpdates`;
        const response = await axios.get(url, { timeout: 10000 });
        res.json(response.data);
    } catch (error) {
        console.error('❌ Error fetching Telegram updates:', error.message);
        let errorMsg = 'Không thể lấy updates từ Telegram';
        if (error.response?.data?.description) {
            errorMsg += ': ' + error.response.data.description;
        }
        res.status(500).json({ success: false, message: errorMsg });
    }
});

// Get Telegram configuration
app.get('/api/telegram/config', verifyToken, async (req, res) => {
    try {
        res.json({ 
            success: true, 
            config: {
                enabled: config.telegram.enabled,
                botToken: config.telegram.botToken ? '***set***' : '',
                chatId: config.telegram.chatId,
                refreshInterval: config.telegram.refreshInterval || 15,
                delayThreshold: config.telegram.delayThreshold || 60,
                alertRepeatInterval: config.telegram.alertRepeatInterval || 60,
                alertMinutes: config.telegram.alertMinutes || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
            }
        });
    } catch (error) {
        console.error('Error fetching Telegram config:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể lấy cấu hình Telegram',
            error: error.message 
        });
    }
});

// Health check endpoint for telegram alerts (no auth required for monitoring)
app.get('/api/telegram/health', async (req, res) => {
    try {
        const health = {
            configLoaded: !!config.telegram,
            enabled: config.telegram?.enabled || false,
            botTokenSet: !!(config.telegram?.botToken),
            chatIdSet: !!(config.telegram?.chatId),
            intervalActive: !!telegramAlertInterval,
            initialized: telegramAlertInitialized,
            configFile: TELEGRAM_CONFIG_FILE,
            configFileExists: fs.existsSync(TELEGRAM_CONFIG_FILE),
            dataDir: DATA_DIR,
            dataDirSet: !!process.env.DATA_DIR,
            alertHistory: serverAlertHistory.size,
            settings: {
                refreshInterval: config.telegram?.refreshInterval || 15,
                delayThreshold: config.telegram?.delayThreshold || 60,
                alertRepeatInterval: config.telegram?.alertRepeatInterval || 60,
                alertMinutes: config.telegram?.alertMinutes || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
            }
        };
        
        // Overall status
        const isHealthy = health.enabled && 
                         health.botTokenSet && 
                         health.chatIdSet && 
                         health.intervalActive;
        
        res.json({
            success: true,
            status: isHealthy ? 'healthy' : 'unhealthy',
            ...health,
            warnings: [
                !health.dataDirSet && process.env.NODE_ENV === 'production' 
                    ? 'DATA_DIR not set - config may be lost on restart' 
                    : null,
                !health.enabled ? 'Telegram alerts disabled' : null,
                !health.botTokenSet ? 'Bot token not configured' : null,
                !health.chatIdSet ? 'Chat ID not configured' : null,
                !health.intervalActive ? 'Alert interval not running' : null
            ].filter(Boolean)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'error',
            error: error.message
        });
    }
});

// Update Telegram configuration
app.post('/api/telegram/config', verifyToken, async (req, res) => {
    try {
        // Only admin can update config
        if (req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Chỉ admin mới có thể cập nhật cấu hình' 
            });
        }
        
        const { enabled, chatId, refreshInterval, delayThreshold, alertRepeatInterval, alertMinutes, botToken } = req.body;
        
        // Validate bot token format if provided
        if (botToken !== undefined && String(botToken).trim() !== '' && botToken !== '***set***') {
            const tokenStr = String(botToken).trim();
            if (!tokenStr.includes(':')) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Bot token không hợp lệ. Token phải có định dạng: 1234567890:ABCdef... (lấy từ @BotFather)' 
                });
            }
            config.telegram.botToken = tokenStr;
        }
        
        if (enabled !== undefined) {
            config.telegram.enabled = Boolean(enabled);
        }
        
        if (chatId !== undefined) {
            config.telegram.chatId = String(chatId).trim();
        }
        
        if (refreshInterval !== undefined) {
            config.telegram.refreshInterval = Math.max(15, parseInt(refreshInterval));
        }
        
        if (delayThreshold !== undefined) {
            config.telegram.delayThreshold = Math.max(1, parseInt(delayThreshold));
        }
        
        if (alertRepeatInterval !== undefined) {
            config.telegram.alertRepeatInterval = Math.max(1, parseInt(alertRepeatInterval));
        }

        if (alertMinutes !== undefined) {
            // Validate: must be array of numbers in range 0-59
            if (Array.isArray(alertMinutes)) {
                const validMinutes = alertMinutes
                    .map(m => parseInt(m))
                    .filter(m => !isNaN(m) && m >= 0 && m <= 59);
                config.telegram.alertMinutes = validMinutes;
            }
        }
        
        // Save to file
        const saved = saveTelegramConfig();
        
        if (!saved) {
            return res.status(500).json({ 
                success: false, 
                message: 'Không thể lưu cấu hình vào file' 
            });
        }
        
        // Restart periodic alert interval with new config
        startTelegramAlertInterval();
        
        res.json({ 
            success: true, 
            message: 'Đã cập nhật và lưu cấu hình Telegram',
            config: {
                enabled: config.telegram.enabled,
                botToken: config.telegram.botToken ? '***set***' : '',
                chatId: config.telegram.chatId,
                refreshInterval: config.telegram.refreshInterval || 15,
                delayThreshold: config.telegram.delayThreshold || 60,
                alertRepeatInterval: config.telegram.alertRepeatInterval || 60,
                alertMinutes: config.telegram.alertMinutes || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]
            }
        });
        
    } catch (error) {
        console.error('Error updating Telegram config:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Không thể cập nhật cấu hình',
            error: error.message 
        });
    }
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
        try {
            if (!visitorStats.todayVisitors.has(sessionId)) {
                visitorStats.todayVisitors.add(sessionId);
                // Increment in database
                dbStats = await dbModule.incrementVisitorCount();
            } else {
                // Just get current stats from database
                dbStats = await dbModule.getVisitorStats();
            }
        } catch (dbError) {
            console.error('Database error in register visit:', dbError.message);
            // Use fallback stats if database fails
            dbStats = {
                total_visitors: 20102347,
                today_visitors: visitorStats.todayVisitors.size
            };
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
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            stats: {
                currentVisitors: 0,
                todayVisitors: 0,
                totalVisitors: 20102347
            }
        });
    }
});

// Get current visitor statistics
app.get('/api/visitors/stats', async (req, res) => {
    try {
        cleanupStaleVisitors();
        checkDailyReset();
        
        // Get total visitors from database
        let dbStats;
        try {
            dbStats = await dbModule.getVisitorStats();
        } catch (dbError) {
            console.error('Database error in get stats:', dbError.message);
            // Use fallback stats if database fails
            dbStats = {
                total_visitors: 20102347,
                today_visitors: visitorStats.todayVisitors.size
            };
        }
        
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
        res.status(200).json({ 
            success: true,
            currentVisitors: visitorStats.currentVisitors.size,
            todayVisitors: visitorStats.todayVisitors.size,
            totalVisitors: 20102347
        });
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

// ============================================
// HEALTH CHECK (Lightweight - dành cho Render)
// ============================================
app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: 'unknown',
        mqtt: mqttModule.getConnectionStatus() ? 'connected' : 'disconnected'
    };
    
    // Check database connectivity
    try {
        if (dbModule.pool) {
            await dbModule.pool.query('SELECT NOW()');
            health.database = 'connected';
        } else {
            health.database = 'not_initialized';
            health.status = 'degraded';
        }
    } catch (error) {
        health.database = 'error: ' + error.message;
        health.status = 'degraded';
    }
    
    // Trigger Telegram alert check if enough time has passed (for cron-job.org support)
    // This ensures alerts fire even if setInterval died (Render free plan restarts)
    if (config.telegram.enabled && config.telegram.botToken && config.telegram.chatId) {
        const timeSinceLastCheck = Date.now() - lastTelegramCheckTime;
        
        if (timeSinceLastCheck >= 55 * 1000) { // At most once per minute
            health.telegramCheckTriggered = true;
            // Run async - don't block health response
            checkAndSendTelegramAlerts().catch(err => {
                console.error('❌ [HEALTH] Telegram check error:', err.message);
            });
        } else {
            health.telegramNextCheckIn = Math.ceil((60 * 1000 - timeSinceLastCheck) / 1000) + 's';
        }
    }
    
    res.json(health);
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
        } else if (fs.existsSync(path.join(__dirname, 'data_quantrac.json'))) {
            // Fallback: Đọc từ file JSON nếu không có dữ liệu trong DB
            console.log('⚠️ No TVA data in DB, loading from JSON file');
            const tvaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_quantrac.json'), 'utf8'));
            
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
        } else if (fs.existsSync(path.join(__dirname, 'data_mqtt.json'))) {
            // Fallback: Đọc từ file JSON
            console.log('⚠️ No MQTT data in DB, loading from JSON file');
            const mqttData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_mqtt.json'), 'utf8'));
            
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
        } else if (fs.existsSync(path.join(__dirname, 'data_scada_tva.json'))) {
            // Fallback: Đọc từ file JSON
            console.log('⚠️ No SCADA data in DB, loading from JSON file');
            const scadaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_scada_tva.json'), 'utf8'));
            
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

        // Apply coordinate overrides (admin configurable)
        deduplicatedStations.forEach(station => {
            const override = coordinatesOverride[station.id];
            if (override) {
                station.lat = override.lat;
                station.lng = override.lng;
            }
        });
        
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

// ============================================
// COORDINATES CONFIGURATION API (Admin only)
// ============================================

/**
 * GET /api/coordinates
 * Returns all coordinate overrides (admin only)
 */
app.get('/api/coordinates', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Chỉ admin mới có quyền truy cập' });
    }
    res.json({ success: true, overrides: coordinatesOverride });
});

/**
 * PUT /api/coordinates/:stationId
 * Update coordinates for a single station (admin only)
 */
app.put('/api/coordinates/:stationId', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Chỉ admin mới có quyền cập nhật' });
    }

    const stationId = req.params.stationId;
    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);

    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ success: false, message: 'Latitude hoặc Longitude không hợp lệ' });
    }
    // Reasonable bounds that include all of Vietnam and nearby
    if (lat < 7 || lat > 24 || lng < 99 || lng > 115) {
        return res.status(400).json({ success: false, message: 'Tọa độ nằm ngoài phạm vi Việt Nam' });
    }

    try {
        await dbModule.saveCoordinateOverride(stationId, lat, lng);
        coordinatesOverride[stationId] = { lat, lng };
        console.log(`🗺️  Coordinate override saved: ${stationId} → (${lat}, ${lng})`);
        res.json({ success: true, message: 'Đã cập nhật tọa độ thành công', stationId, lat, lng });
    } catch (e) {
        console.error('❌ saveCoordinateOverride:', e.message);
        res.status(500).json({ success: false, message: 'Không thể lưu cấu hình tọa độ' });
    }
});

/**
 * DELETE /api/coordinates/:stationId
 * Reset coordinates for a station back to default (admin only)
 */
app.delete('/api/coordinates/:stationId', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Chỉ admin mới có quyền xóa' });
    }

    const stationId = req.params.stationId;
    try {
        await dbModule.deleteCoordinateOverride(stationId);
        delete coordinatesOverride[stationId];
        console.log(`🗺️  Coordinate override removed: ${stationId} → default`);
        res.json({ success: true, message: 'Đã reset tọa độ về mặc định', stationId });
    } catch (e) {
        console.error('❌ deleteCoordinateOverride:', e.message);
        res.status(500).json({ success: false, message: 'Không thể xóa cấu hình tọa độ' });
    }
});

/**
 * API: Lấy dữ liệu chỉ trạm TVA
 */
app.get('/api/stations/tva', (req, res) => {
    try {
        if (!fs.existsSync(path.join(__dirname, 'data_quantrac.json'))) {
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy dữ liệu TVA'
            });
        }
        
        const tvaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_quantrac.json'), 'utf8'));
        
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
        if (!fs.existsSync(path.join(__dirname, 'data_mqtt.json'))) {
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy dữ liệu MQTT'
            });
        }
        
        const mqttData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_mqtt.json'), 'utf8'));
        
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
        
        if (type === 'tva' && fs.existsSync(path.join(__dirname, 'data_quantrac.json'))) {
            const tvaData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_quantrac.json'), 'utf8'));
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
        } else if (type === 'mqtt' && fs.existsSync(path.join(__dirname, 'data_mqtt.json'))) {
            const mqttData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data_mqtt.json'), 'utf8'));
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
                parameter_name,
                value,
                unit,
                timestamp
            FROM scada_data
            ORDER BY station_name, parameter_name, timestamp DESC
        `);
        
        // Group data by station
        const stationsGrouped = {};
        let latestTimestamp = null;
        
        for (const row of result.rows) {
            // Generate station ID from station name
            const stationId = row.station_name.replace(/\s+/g, '_');
            
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
                timestamp: row.timestamp
            });
            
            // Track the most recent timestamp
            if (!latestTimestamp || new Date(row.timestamp) > new Date(latestTimestamp)) {
                latestTimestamp = row.timestamp;
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


// ============================================
// SERVER-SIDE TELEGRAM PERIODIC ALERTS
// ============================================

// Persistent alert history file (survives restarts on Render)
const ALERT_HISTORY_FILE = path.join(DATA_DIR, 'telegram-alert-history.json');

// In-memory alert history: stationName -> { lastAlertTime, lastAlertStatus }
const serverAlertHistory = new Map();
let telegramAlertInterval = null;
let telegramAlertInitialized = false; // First run: snapshot only, don't alert
let lastTelegramCheckTime = 0; // Track last check time for rate limiting

// Load alert history from persistent file (survive Render restarts)
function loadAlertHistory() {
    try {
        if (fs.existsSync(ALERT_HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(ALERT_HISTORY_FILE, 'utf8'));
            if (data.history && typeof data.history === 'object') {
                for (const [key, val] of Object.entries(data.history)) {
                    serverAlertHistory.set(key, val);
                }
            }
            if (data.lastCheckTime) {
                lastTelegramCheckTime = data.lastCheckTime;
            }
            // If we loaded history, skip the snapshot phase
            if (serverAlertHistory.size > 0) {
                telegramAlertInitialized = true;
                console.log(`\u2705 [TELEGRAM] Loaded alert history: ${serverAlertHistory.size} stations (skip snapshot)`);
            }
        }
    } catch (err) {
        console.error('\u26a0\ufe0f [TELEGRAM] Error loading alert history:', err.message);
    }
}

// Save alert history to persistent file
function saveAlertHistory() {
    try {
        const data = {
            history: Object.fromEntries(serverAlertHistory),
            lastCheckTime: lastTelegramCheckTime,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(ALERT_HISTORY_FILE, JSON.stringify(data), 'utf8');
    } catch (err) {
        console.error('\u26a0\ufe0f [TELEGRAM] Error saving alert history:', err.message);
    }
}

function getMigratedChatId(error) {
    const migrateToChatId = error?.response?.data?.parameters?.migrate_to_chat_id;
    return migrateToChatId ? String(migrateToChatId) : null;
}

async function sendTelegramMessageWithFallback(chatId, text, botTokenOverride = null) {
    const botToken = botTokenOverride || config.telegram.botToken;
    if (!botToken || !chatId) {
        throw new Error('botToken hoặc chatId chưa được cấu hình');
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
        const response = await axios.post(url, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
        }, { timeout: 10000 });

        if (!response.data.ok) {
            throw new Error('Telegram API trả về lỗi');
        }

        return {
            data: response.data,
            chatId: String(chatId),
            migrated: false
        };
    } catch (error) {
        const migratedChatId = getMigratedChatId(error);
        if (!migratedChatId) {
            throw error;
        }

        console.warn(`⚠️ [TELEGRAM] Chat upgraded to supergroup, retrying with new chat ID: ${migratedChatId}`);

        const retryResponse = await axios.post(url, {
            chat_id: migratedChatId,
            text,
            parse_mode: 'HTML'
        }, { timeout: 10000 });

        if (!retryResponse.data.ok) {
            throw new Error('Telegram API trả về lỗi');
        }

        if (!botTokenOverride && String(config.telegram.chatId) === String(chatId)) {
            config.telegram.chatId = migratedChatId;
            saveTelegramConfig();
        }

        return {
            data: retryResponse.data,
            chatId: migratedChatId,
            migrated: true
        };
    }
}

async function sendServerTelegramMessage(text) {
    const chatId = config.telegram.chatId;
    const result = await sendTelegramMessageWithFallback(chatId, text);
    return result.data;
}

/**
 * Format measurement timestamp for Telegram alert: HH:mm-DD/MM (Vietnam time)
 */
function formatAlertTime(timestamp) {
    if (!timestamp) return 'N/A';
    const d = new Date(typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
    if (isNaN(d.getTime())) return 'N/A';
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit',
        hour12: false
    }).formatToParts(d);
    const get = type => parts.find(p => p.type === type)?.value || '00';
    return `${get('hour')}:${get('minute')}-${get('day')}/${get('month')}`;
}

function formatPermitForAlert(permit) {
    if (!permit) return '';
    const permitStr = String(permit).trim();
    const numberMatch = permitStr.match(/(\d+)/);
    if (numberMatch) {
        return `GP${numberMatch[1]}`;
    }
    return permitStr;
}

function buildStationLine(index, stationName, status) {
    const formattedPermit = formatPermitForAlert(status.permit);
    const permitText = formattedPermit ? ` -${formattedPermit}` : '';
    const timeStr = formatAlertTime(status.measurementMs || status.measurementTime);
    return `${index}. ${stationName}${permitText}. Lúc: ${timeStr}`;
}

async function checkAndSendTelegramAlerts() {
    try {
        const vnNow = new Date();
        console.log(`\n🔍 [TELEGRAM] Running periodic check at ${vnNow.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);

        if (!config.telegram.enabled || !config.telegram.botToken || !config.telegram.chatId) {
            console.log('⚠️ [TELEGRAM] Skipping: Telegram not properly configured');
            return;
        }

        const delayThreshold = config.telegram.delayThreshold || 60;
        const alertMinutes = config.telegram.alertMinutes || [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        const now = Date.now();
        lastTelegramCheckTime = now;

        // Determine current Vietnam minute-of-hour
        const vnTimeStr = vnNow.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit' });
        const [hours, currentMinute] = vnTimeStr.split(':').map(Number);
        const isRepeatTime = alertMinutes.includes(currentMinute);

        console.log(`   • VN time: ${String(hours).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`);
        console.log(`   • Alert minutes: [${alertMinutes.join(', ')}], is repeat time: ${isRepeatTime}`);

        // Fetch MONRE data
        let monreData;
        try {
            monreData = await monreModule.getPermitData();
        } catch (err) {
            console.error('❌ [TELEGRAM] Failed to fetch MONRE data:', err.message);
            return;
        }

        if (!monreData || monreData.length === 0) {
            console.log('⚠️ [TELEGRAM] No MONRE data available');
            return;
        }

        // Group by station, keep newest measurement per station
        const stationStatus = {};
        for (const row of monreData) {
            const station = row.station || 'N/A';
            let measurementMs = null;
            if (typeof row.measurementTime === 'number') {
                measurementMs = row.measurementTime;
            } else if (row.measurementTime) {
                const parsed = Date.parse(row.measurementTime);
                if (!isNaN(parsed)) measurementMs = parsed;
            }
            if (measurementMs === null) continue;

            const delayMinutes = Math.floor((now - measurementMs) / (1000 * 60));

            if (!stationStatus[station] || measurementMs > (stationStatus[station].measurementMs || 0)) {
                stationStatus[station] = {
                    status: delayMinutes > delayThreshold ? 'offline' : 'online',
                    delayMinutes,
                    measurementMs,
                    measurementTime: row.measurementTime,
                    permit: row.permit || null
                };
            }
        }

        // Filter out DKG stations from alerts
        const alertableStations = Object.entries(stationStatus)
            .filter(([stationName]) => !isDKGStation(stationName))
            .reduce((acc, [name, status]) => {
                acc[name] = status;
                return acc;
            }, {});
        
        const totalStations = Object.keys(alertableStations).length;
        const offlineCount = Object.values(alertableStations).filter(s => s.status === 'offline').length;
        const offlineStations = Object.entries(alertableStations)
            .filter(([, status]) => status.status === 'offline')
            .sort((a, b) => a[0].localeCompare(b[0], 'vi'));
        console.log(`   • Total stations: ${totalStations}, offline: ${offlineCount} (DKG stations excluded from alerts)`);

        let statusChangedCount = 0;
        let repeatOfflineCount = 0;

        for (const [stationName, status] of Object.entries(alertableStations)) {
            const history = serverAlertHistory.get(stationName);
            const prevStatus = history?.lastAlertStatus; // undefined on first run

            if (prevStatus === undefined) {
                // First time seeing this station
                if (status.status === 'offline') {
                    statusChangedCount++;
                }
                // Online on first run: just record, no alert
            } else if (prevStatus !== status.status) {
                // Status changed (offline→online or online→offline)
                statusChangedCount++;
            } else if (status.status === 'offline' && isRepeatTime) {
                // Still offline + now is a configured repeat minute
                repeatOfflineCount++;
            }
        }

        function buildOfflineSummaryMessage() {
            if (offlineStations.length === 0) {
                return 'Các trạm: ✅ Bình thường';
            }
            const lines = [`📡 Chưa gửi dữ liệu: ${offlineCount}/${totalStations}`];
            offlineStations.forEach(([stationName, status], index) => {
                lines.push(buildStationLine(index + 1, stationName, status));
            });
            return lines.join('\n');
        }

        // Send status-change alert (immediate)
        if (statusChangedCount > 0) {
            const message = buildOfflineSummaryMessage();
            try {
                await sendServerTelegramMessage(message);
                console.log(`✅ [TELEGRAM] Sent immediate alert after ${statusChangedCount} status change(s)`);
            } catch (err) {
                console.error('❌ [TELEGRAM] Failed to send status-change alert:', err.message);
            }
        }

        // Send repeat alert for persistently-offline stations
        if (repeatOfflineCount > 0) {
            const message = buildOfflineSummaryMessage();
            try {
                await sendServerTelegramMessage(message);
                console.log(`✅ [TELEGRAM] Sent repeat alert for ${repeatOfflineCount} offline station(s)`);
            } catch (err) {
                console.error('❌ [TELEGRAM] Failed to send repeat alert:', err.message);
            }
        }

        if (statusChangedCount === 0 && repeatOfflineCount === 0) {
            console.log('   ⏭️ No status changes and not a scheduled repeat time, skipping');
        }

        // Update history for ALL stations so future runs can detect changes correctly
        for (const [stationName, status] of Object.entries(stationStatus)) {
            const existing = serverAlertHistory.get(stationName);
            serverAlertHistory.set(stationName, {
                lastAlertTime: existing?.lastAlertTime || now,
                lastAlertStatus: status.status
            });
        }

        saveAlertHistory();
        console.log('✓ [TELEGRAM] Check completed');
    } catch (error) {
        console.error('❌ [TELEGRAM] Error during periodic check:', error.message);
    }
}

function startTelegramAlertInterval() {
    console.log('\n🔔 [TELEGRAM] Attempting to start alert interval...');
    console.log('   • Enabled:', config.telegram.enabled);
    console.log('   • Bot Token:', config.telegram.botToken ? '***set***' : '❌ MISSING');
    console.log('   • Chat ID:', config.telegram.chatId || '❌ MISSING');
    console.log('   • Refresh Interval:', config.telegram.refreshInterval || 15, 'minutes');
    console.log('   • Delay Threshold:', config.telegram.delayThreshold || 60, 'minutes');
    console.log('   • Alert Minutes:', (config.telegram.alertMinutes || [5,10,15,20,25,30,35,40,45,50,55]).join(','));
    
    if (telegramAlertInterval) {
        clearInterval(telegramAlertInterval);
        telegramAlertInterval = null;
        console.log('   ↳ Cleared existing interval');
    }
    
    if (!config.telegram.enabled) {
        console.log('   ⚠️  Telegram alerts DISABLED in config');
        return;
    }
    
    if (!config.telegram.botToken) {
        console.log('   ❌ Cannot start: Bot Token is missing');
        console.log('   → Please configure via Settings > Telegram Config');
        return;
    }
    
    if (!config.telegram.chatId) {
        console.log('   ❌ Cannot start: Chat ID is missing');
        console.log('   → Please configure via Settings > Telegram Config');
        return;
    }
    
    // Check every minute to catch configured alert minutes
    const intervalMs = 60 * 1000;
    
    telegramAlertInterval = setInterval(checkAndSendTelegramAlerts, intervalMs);
    const alertMinutesStr = (config.telegram.alertMinutes || [5,10,15,20,25,30,35,40,45,50,55]).join(', ');
    console.log(`   ✅ Alert interval STARTED: check every 1 min, alerts at minutes [${alertMinutesStr}] or on status change`);
    
    // Run once immediately on start
    checkAndSendTelegramAlerts();
}

// Khởi động server
app.listen(PORT, async () => {
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║           WEB SERVER - HỆ THỐNG QUAN TRẮC NƯỚC CA MAU                   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/stations`);
    
    // Check environment configuration
    console.log('\n⚙️  Kiểm tra cấu hình môi trường:');
    console.log(`   • NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   • DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Đã cấu hình' : '⚠️ Chưa cấu hình (sử dụng giá trị mặc định)'}`);
    console.log(`   • JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Đã cấu hình' : '⚠️ Chưa cấu hình (sử dụng giá trị mặc định)'}`);
    
    if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
        console.warn('\n⚠️  CẢNH BÁO: Đang chạy production nhưng DATABASE_URL chưa được đặt!');
        console.warn('   → Vui lòng đặt DATABASE_URL trong Render Dashboard');
    }
    
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
        // Load coordinate overrides from DB after DB is ready
        await reloadCoordinatesOverride();
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

    // =================================================
    // CẢNH BÁO TELEGRAM ĐỊNH KỲ (Server-side)
    // =================================================
    // Load alert history from persistent file (survive restarts)
    loadAlertHistory();
    
    // Khởi động sau 30 giây để DB có dữ liệu trước
    console.log('\n⏱️  Scheduling telegram alert check in 30 seconds...');
    setTimeout(() => {
        console.log('\n🚀 30 seconds elapsed, starting telegram alert system...');
        startTelegramAlertInterval();
    }, 30000);
    
    // =================================================
    // SELF-PING KEEP-ALIVE (Prevent Render free plan sleep)
    // =================================================
    // Resolve keep-alive URL from multiple sources
    const keepAliveUrl = process.env.KEEP_ALIVE_URL
        || process.env.RENDER_EXTERNAL_URL
        || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : null);
    
    // Always enable self-ping to keep the server alive and ensure telegram alerts fire
    // even when no users are online. Use external URL if available, otherwise localhost.
    const pingUrl = keepAliveUrl || `http://localhost:${PORT}`;
    const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
    
    const selfPing = async () => {
        try {
            const res = await axios.get(`${pingUrl}/health`, { timeout: 15000 });
            console.log(`🏓 [KEEP-ALIVE] Self-ping OK (status: ${res.data.status}, uptime: ${Math.floor(res.data.uptime)}s)`);
        } catch (err) {
            console.warn(`⚠️ [KEEP-ALIVE] Self-ping failed: ${err.message}`);
        }
    };
    
    setInterval(selfPing, KEEP_ALIVE_INTERVAL);
    console.log(`🏓 [KEEP-ALIVE] Self-ping enabled: every 5 min → ${pingUrl}/health`);
    
    // Verify the URL works on startup (after a short delay so the server is ready)
    setTimeout(selfPing, 5000);
    
    if (!keepAliveUrl && process.env.NODE_ENV === 'production') {
        console.warn('⚠️ [KEEP-ALIVE] Đang dùng localhost self-ping. Nếu Render cho sleep tiến trình, hãy:');
        console.warn('   → Set KEEP_ALIVE_URL=https://your-app.onrender.com trong Render Dashboard');
    }
    
    console.log('🔄 Tự động lưu dữ liệu vào SQL mỗi 5 phút\n');
});

// Xử lý khi thoát
process.on('SIGINT', () => {
    console.log('\n\n🛑 Đang dừng server...');
    process.exit(0);
});
