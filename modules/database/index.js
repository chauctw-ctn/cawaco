/**
 * Database Module - PostgreSQL Operations
 * Module quản lý kết nối và operations với PostgreSQL database
 */

const { Pool } = require('pg');
const config = require('../../config');

let pool;

// ============= CACHE LAYER =============
// In-memory cache với TTL để giảm tải database
const cache = {
    data: new Map(),
    
    set(key, value, ttlSeconds = 60) {
        this.data.set(key, {
            value: value,
            expiry: Date.now() + (ttlSeconds * 1000)
        });
    },
    
    get(key) {
        const item = this.data.get(key);
        if (!item) return null;
        
        // Kiểm tra expiry
        if (Date.now() > item.expiry) {
            this.data.delete(key);
            return null;
        }
        
        return item.value;
    },
    
    delete(key) {
        this.data.delete(key);
    },
    
    clear() {
        this.data.clear();
    },
    
    // Cleanup expired items periodically
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.data.entries()) {
            if (now > item.expiry) {
                this.data.delete(key);
            }
        }
    }
};

// Cleanup cache mỗi 5 phút
setInterval(() => {
    cache.cleanup();
    console.log(`🧹 Cache cleanup: ${cache.data.size} items remaining`);
}, 5 * 60 * 1000);

/**
 * Lấy timestamp hiện tại
 * 
 * QUAN TRỌNG:
 * - PostgreSQL TIMESTAMPTZ tự động xử lý timezone
 * - Connection pool đã set timezone = 'Asia/Ho_Chi_Minh'
 * - Chỉ cần gửi timestamp chuẩn ISO/UTC, PostgreSQL sẽ tự convert và lưu đúng
 * - Khi query, PostgreSQL trả về theo timezone session (GMT+7)
 * 
 * Trả về: ISO 8601 UTC string (JavaScript standard)
 */
function getVietnamTimestamp() {
    // Cách 1: Đơn giản nhất - return ISO UTC, để PostgreSQL xử lý
    return new Date().toISOString();
    
    // PostgreSQL sẽ:
    // 1. Nhận ISO timestamp (UTC)
    // 2. Lưu internally as UTC
    // 3. Khi query với timezone='Asia/Ho_Chi_Minh', tự động chuyển sang GMT+7
}

/**
 * Parse giá trị số, xử lý dấu phẩy ngăn cách hàng nghìn
 * Ví dụ: "3,584,318.00" -> 3584318.00
 */
function parseNumericValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    
    // Nếu đã là số, trả về luôn
    if (typeof value === 'number') {
        return value;
    }
    
    // Chuyển thành string và remove tất cả dấu phẩy
    const cleanValue = String(value).replace(/,/g, '');
    const numericValue = parseFloat(cleanValue);
    
    return isNaN(numericValue) ? null : numericValue;
}

/**
 * Chuẩn hóa tên parameter dựa trên giá trị và đơn vị
 * Tự động phát hiện và sửa tên parameter sai (ví dụ: "Lưu lượng" nhưng giá trị > 1000 => "Tổng lưu lượng")
 */
function normalizeParameterNameByValue(paramName, value, unit) {
    if (!paramName) return paramName;
    
    const name = paramName.trim();
    const lowerName = name.toLowerCase();
    const numValue = parseNumericValue(value);
    const lowerUnit = (unit || '').toLowerCase();
    
    // Nếu không có giá trị số, trả về tên gốc
    if (numValue === null || numValue === undefined || isNaN(numValue)) {
        return name;
    }
    
    // Phát hiện "Lưu lượng" nhầm với "Tổng lưu lượng"
    // Nếu tên có chứa "lưu lượng" NHƯNG KHÔNG có "tổng"
    if ((lowerName.includes('lưu lượng') || lowerName.includes('luu luong') || lowerName.includes('ll')) && 
        !lowerName.includes('tổng') && !lowerName.includes('tong')) {
        
        // Nếu giá trị > 1000 => gần như chắc chắn là Tổng lưu lượng (index)
        // Hoặc nếu đơn vị là m³ (không có /h) => là Tổng lưu lượng
        if (numValue > 1000 || (lowerUnit === 'm³' || lowerUnit === 'm3')) {
            console.log(`🔄 Sửa parameter: "${name}" (${numValue} ${unit}) -> "Tổng lưu lượng"`);
            return 'Tổng lưu lượng';
        }
        // Nếu giá trị <= 1000 và đơn vị là m³/h => là Lưu lượng thực
        else if (lowerUnit.includes('/h') || lowerUnit.includes('h')) {
            return 'Lưu lượng';
        }
    }
    
    // Phát hiện "Tổng lưu lượng" nhầm với "Lưu lượng"  
    // Nếu tên có chứa "tổng" và "lưu lượng"
    if ((lowerName.includes('tổng lưu lượng') || lowerName.includes('tong luu luong') || lowerName.includes('tổng ll'))) {
        
        // Nếu giá trị < 1000 và đơn vị có /h => có thể là Lưu lượng (tức thời)
        if (numValue < 1000 && (lowerUnit.includes('/h') || lowerUnit.includes('h'))) {
            console.log(`🔄 Sửa parameter: "${name}" (${numValue} ${unit}) -> "Lưu lượng"`);
            return 'Lưu lượng';
        }
        // Nếu giá trị >= 1000 hoặc đơn vị là m³ => giữ là Tổng lưu lượng
        else {
            return 'Tổng lưu lượng';
        }
    }
    
    // Các trường hợp khác, giữ nguyên tên
    return name;
}

/**
 * Khởi tạo connection pool
 */
function initPool() {
    if (pool) return pool;

    try {
        const poolConfig = {
            connectionString: config.database.url,
            ssl: config.database.ssl,
            // Tối ưu connection pool cho cloud deployment
            max: 10,                    // Số kết nối tối đa (giảm cho Render free tier)
            min: 2,                     // Số kết nối tối thiểu
            idleTimeoutMillis: 30000,   // Timeout cho kết nối idle (30s)
            connectionTimeoutMillis: 10000, // Timeout khi tạo kết nối mới (10s tăng từ 5s)
            maxUses: 7500,              // Số lần sử dụng tối đa trước khi đóng kết nối
            allowExitOnIdle: false,     // Không thoát khi idle
            // Thêm query timeout để tránh queries bị treo
            query_timeout: 60000,       // 60s query timeout
            statement_timeout: 60000    // 60s statement timeout
        };
        
        // Nếu có options trong config (timezone), thêm vào
        if (config.database.options) {
            poolConfig.options = config.database.options;
        }

        pool = new Pool(poolConfig);

        // Set timezone for all connections in the pool
        pool.on('connect', (client) => {
            // Tối ưu performance cho mỗi connection
            client.query(`
                SET timezone = 'Asia/Ho_Chi_Minh';
                SET statement_timeout = '60s';
                SET work_mem = '32MB';
            `, (err) => {
                if (err) {
                    console.error('❌ Lỗi thiết lập connection:', err.message);
                }
            });
        });
        
        // Handle pool errors
        pool.on('error', (err, client) => {
            console.error('❌ Unexpected database pool error:', err.message);
            console.error('Stack:', err.stack);
        });

        // Test connection với timeout
        const testConnection = async () => {
            try {
                const result = await pool.query('SELECT NOW()');
                console.log('✅ Đã kết nối tới PostgreSQL database');
                console.log('🇻🇳 Server time (GMT+7):', result.rows[0].now);
                return true;
            } catch (err) {
                console.error('❌ Lỗi kết nối PostgreSQL database:', err.message);
                console.error('Connection string format:', config.database.url ? 'present' : 'missing');
                throw err;
            }
        };
        
        // Test connection asynchronously
        testConnection().catch(err => {
            console.error('⚠️ Database connection test failed, but pool is initialized');
            console.error('Will retry on first query...');
        });

        return pool;
    } catch (error) {
        console.error('❌ Lỗi khởi tạo PostgreSQL:', error.message);
        process.exit(1);
    }
}

/**
 * Khởi tạo các bảng trong database
 */
async function initDatabase() {
    initPool();
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Bảng lưu dữ liệu TVA
        await client.query(`
            CREATE TABLE IF NOT EXISTS tva_data (
                id SERIAL PRIMARY KEY,
                station_name TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng tva_data đã sẵn sàng');
        
        // Migration: Rename created_at to timestamp if it exists
        await client.query(`
            DO $$ 
            BEGIN
                IF EXISTS(SELECT 1 FROM information_schema.columns 
                          WHERE table_name='tva_data' AND column_name='created_at') THEN
                    ALTER TABLE tva_data RENAME COLUMN created_at TO timestamp;
                END IF;
            END $$;
        `);
        
        // Migration: Add timestamp column if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
                              WHERE table_name='tva_data' AND column_name='timestamp') THEN
                    ALTER TABLE tva_data ADD COLUMN timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        // Drop old columns if they exist (migration to simplified schema)
        await client.query(`
            ALTER TABLE tva_data 
            DROP COLUMN IF EXISTS station_id,
            DROP COLUMN IF EXISTS device_name,
            DROP COLUMN IF EXISTS data_timestamp
        `);
        
        // Composite indexes cho tva_data - tối ưu cho query patterns thường dùng
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_station_time ON tva_data(station_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_param_time ON tva_data(parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_station_param_time ON tva_data(station_name, parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_time ON tva_data(timestamp DESC)');
        // Drop old indexes
        await client.query('DROP INDEX IF EXISTS idx_tva_station');
        await client.query('DROP INDEX IF EXISTS idx_tva_created_at');
        await client.query('DROP INDEX IF EXISTS idx_tva_parameter');

        // Bảng lưu dữ liệu MQTT
        await client.query(`
            CREATE TABLE IF NOT EXISTS mqtt_data (
                id SERIAL PRIMARY KEY,
                station_name TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng mqtt_data đã sẵn sàng');
        
        // Migration: Rename created_at to timestamp if it exists
        await client.query(`
            DO $$ 
            BEGIN
                IF EXISTS(SELECT 1 FROM information_schema.columns 
                          WHERE table_name='mqtt_data' AND column_name='created_at') THEN
                    ALTER TABLE mqtt_data RENAME COLUMN created_at TO timestamp;
                END IF;
            END $$;
        `);
        
        // Migration: Add timestamp column if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
                              WHERE table_name='mqtt_data' AND column_name='timestamp') THEN
                    ALTER TABLE mqtt_data ADD COLUMN timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        // Drop old columns if they exist (migration to simplified schema)
        await client.query(`
            ALTER TABLE mqtt_data 
            DROP COLUMN IF EXISTS station_id,
            DROP COLUMN IF EXISTS device_name,
            DROP COLUMN IF EXISTS data_timestamp
        `);
        
        // Composite indexes cho mqtt_data
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_station_time ON mqtt_data(station_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_param_time ON mqtt_data(parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_station_param_time ON mqtt_data(station_name, parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_time ON mqtt_data(timestamp DESC)');
        // Drop old indexes
        await client.query('DROP INDEX IF EXISTS idx_mqtt_station');
        await client.query('DROP INDEX IF EXISTS idx_mqtt_created_at');
        await client.query('DROP INDEX IF EXISTS idx_mqtt_parameter');

        // Bảng lưu dữ liệu SCADA
        await client.query(`
            CREATE TABLE IF NOT EXISTS scada_data (
                id SERIAL PRIMARY KEY,
                station_name TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng scada_data đã sẵn sàng');
        
        // Migration: Rename created_at to timestamp if it exists
        await client.query(`
            DO $$ 
            BEGIN
                IF EXISTS(SELECT 1 FROM information_schema.columns 
                          WHERE table_name='scada_data' AND column_name='created_at') THEN
                    ALTER TABLE scada_data RENAME COLUMN created_at TO timestamp;
                END IF;
            END $$;
        `);
        
        // Migration: Add timestamp column if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
                              WHERE table_name='scada_data' AND column_name='timestamp') THEN
                    ALTER TABLE scada_data ADD COLUMN timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        // Drop old columns if they exist (migration to simplified schema)
        await client.query(`
            ALTER TABLE scada_data 
            DROP COLUMN IF EXISTS station_id,
            DROP COLUMN IF EXISTS device_name,
            DROP COLUMN IF EXISTS data_timestamp
        `);
        
        // Composite indexes cho scada_data
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_station_time ON scada_data(station_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_param_time ON scada_data(parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_station_param_time ON scada_data(station_name, parameter_name, timestamp DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_time ON scada_data(timestamp DESC)');
        // Drop old indexes
        await client.query('DROP INDEX IF EXISTS idx_scada_station');
        await client.query('DROP INDEX IF EXISTS idx_scada_created_at');
        await client.query('DROP INDEX IF EXISTS idx_scada_parameter');

        // Bảng lưu thông tin trạm
        await client.query(`
            CREATE TABLE IF NOT EXISTS stations (
                id SERIAL PRIMARY KEY,
                station_id TEXT UNIQUE NOT NULL,
                station_name TEXT NOT NULL,
                station_type TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng stations đã sẵn sàng');

        // Bảng lưu tọa độ tùy chỉnh cho marker bản đồ
        await client.query(`
            CREATE TABLE IF NOT EXISTS coordinate_overrides (
                station_id TEXT PRIMARY KEY,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('\u2705 B\u1ea3ng coordinate_overrides \u0111\u00e3 s\u1eb5n s\u00e0ng');

        // Bảng lưu thống kê visitor
        await client.query(`
            CREATE TABLE IF NOT EXISTS visitor_stats (
                id SERIAL PRIMARY KEY,
                total_visitors BIGINT NOT NULL DEFAULT 20102347,
                today_date DATE NOT NULL DEFAULT CURRENT_DATE,
                today_visitors INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng visitor_stats đã sẵn sàng');
        
        // Khởi tạo giá trị mặc định nếu chưa có
        const visitorCheck = await client.query('SELECT COUNT(*) as count FROM visitor_stats');
        if (parseInt(visitorCheck.rows[0].count) === 0) {
            // Get current date in Vietnam timezone
            const todayVietnam = await client.query(`
                SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date as today
            `);
            await client.query(`
                INSERT INTO visitor_stats (total_visitors, today_date, today_visitors)
                VALUES (20102347, $1, 0)
            `, [todayVietnam.rows[0].today]);
            console.log('✅ Khởi tạo visitor_stats với total = 20,102,347 (GMT+7)');
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Lỗi khởi tạo database:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Xóa records cũ nhất để giữ trong giới hạn
 */
async function cleanupOldRecords(tableName, maxRecords) {
    const client = await pool.connect();
    
    try {
        const countResult = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const currentCount = parseInt(countResult.rows[0].count);
        
        if (currentCount <= maxRecords) {
            return 0;
        }
        
        const deleteCount = currentCount - maxRecords;
        const deleteQuery = `
            DELETE FROM ${tableName}
            WHERE id IN (
                SELECT id FROM ${tableName}
                ORDER BY timestamp ASC
                LIMIT $1
            )
        `;
        
        const result = await client.query(deleteQuery, [deleteCount]);
        console.log(`🗑️ Đã xóa ${result.rowCount} records cũ từ ${tableName}`);
        return result.rowCount;
    } catch (err) {
        console.error(`❌ Lỗi xóa dữ liệu cũ từ ${tableName}:`, err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Lưu thông tin trạm
 */
async function saveStationInfo(stationId, stationName, stationType, lat, lng, client = null) {
    const shouldRelease = !client;
    if (!client) {
        client = await pool.connect();
    }
    
    try {
        await client.query(
            `INSERT INTO stations (station_id, station_name, station_type, latitude, longitude)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (station_id) 
             DO UPDATE SET 
                station_name = EXCLUDED.station_name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude`,
            [stationId, stationName, stationType, lat, lng]
        );
    } catch (err) {
        console.error(`⚠️ Lỗi lưu thông tin trạm ${stationId}:`, err.message);
    } finally {
        if (shouldRelease) {
            client.release();
        }
    }
}

/**
 * Lưu dữ liệu TVA vào database
 */
async function saveTVAData(stations) {
    if (!stations || stations.length === 0) {
        return 0;
    }

    let savedCount = 0;
    const client = await pool.connect();
    
    try {
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of stations) {
            const stationId = `tva_${station.station.replace(/\s+/g, '_')}`;
            
            await saveStationInfo(stationId, station.station, 'TVA', null, null, client);

            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        const cleanValue = parseNumericValue(param.value);
                        const normalizedParamName = normalizeParameterNameByValue(param.name, cleanValue, param.unit);
                        
                        await client.query(
                            `INSERT INTO tva_data (station_name, parameter_name, value, unit)
                             VALUES ($1, $2, $3, $4)`,
                            [station.station, normalizedParamName, cleanValue, param.unit]
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('tva_data', config.database.maxRecords.tva);
        
        // Invalidate cache when new data is saved
        cache.delete('latest_stations_data');
        cache.delete('available_parameters');
        
        return savedCount;
    } finally {
        client.release();
    }
}

/**
 * Lưu dữ liệu MQTT vào database
 */
async function saveMQTTData(stations) {
    if (!stations || stations.length === 0) {
        return 0;
    }

    let savedCount = 0;
    const client = await pool.connect();
    
    try {
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of stations) {
            const stationId = `mqtt_${station.station.replace(/\s+/g, '_')}`;
            
            await saveStationInfo(stationId, station.station, 'MQTT', station.lat, station.lng, client);

            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        const cleanValue = parseNumericValue(param.value);
                        const normalizedParamName = normalizeParameterNameByValue(param.name, cleanValue, param.unit);
                        
                        await client.query(
                            `INSERT INTO mqtt_data (station_name, parameter_name, value, unit)
                             VALUES ($1, $2, $3, $4)`,
                            [station.station, normalizedParamName, cleanValue, param.unit]
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('mqtt_data', config.database.maxRecords.mqtt);
        
        // Invalidate cache when new data is saved
        cache.delete('latest_stations_data');
        cache.delete('available_parameters');
        
        return savedCount;
    } finally {
        client.release();
    }
}

/**
 * Lưu dữ liệu SCADA vào database
 */
async function saveSCADAData(stationsGrouped) {
    if (!stationsGrouped || Object.keys(stationsGrouped).length === 0) {
        return 0;
    }

    let savedCount = 0;
    const client = await pool.connect();
    
    try {
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of Object.values(stationsGrouped)) {
            const stationId = `scada_${station.station}`;
            
            await saveStationInfo(stationId, station.stationName || station.station, 'SCADA', null, null, client);

            if (station.parameters && Array.isArray(station.parameters)) {
                for (const param of station.parameters) {
                    let numericValue = null;
                    if (param.value !== undefined && param.value !== null) {
                        numericValue = typeof param.value === 'number' ? param.value : parseFloat(param.value);
                    } else if (param.displayText) {
                        const cleanText = String(param.displayText).replace(/,/g, '');
                        numericValue = parseFloat(cleanText);
                    }

                    try {
                        const paramName = param.parameterName || param.parameter;
                        const normalizedParamName = normalizeParameterNameByValue(paramName, numericValue, param.unit);
                        
                        await client.query(
                            `INSERT INTO scada_data (station_name, parameter_name, value, unit)
                             VALUES ($1, $2, $3, $4)`,
                            [station.stationName || station.station, normalizedParamName, 
                             isNaN(numericValue) ? null : numericValue, param.unit || '']
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.parameterName}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('scada_data', config.database.maxRecords.scada);
        
        // Invalidate cache when new data is saved
        cache.delete('latest_stations_data');
        cache.delete('available_parameters');
        
        return savedCount;
    } finally {
        client.release();
    }
}

/**
 * Lấy dữ liệu thống kê
 */
async function getStatsData(options) {
    const { stationIds, stationType, parameterName, startDate, endDate, limit = 10000, interval = 60 } = options;
    
    // Determine which tables to query
    let tables = [];
    if (stationType === 'all') {
        tables = ['tva_data', 'mqtt_data', 'scada_data'];
    } else if (stationType === 'TVA') {
        tables = ['tva_data'];
    } else if (stationType === 'MQTT') {
        tables = ['mqtt_data'];
    } else if (stationType === 'SCADA') {
        tables = ['scada_data'];
    } else {
        return [];
    }

    const allData = [];
    
    // Ensure timezone is set to GMT+7 for this query session
    await pool.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
    
    for (const table of tables) {
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        // Filter by station names if provided (convert station IDs to names)
        if (stationIds && stationIds.length > 0) {
            // Extract station names from IDs (e.g., "tva_Gieng_1" -> "Gieng 1")
            const stationNames = stationIds.map(id => {
                // Remove prefix like 'tva_', 'mqtt_', 'scada_' and replace underscores with spaces
                return id.replace(/^(tva|mqtt|scada)_/, '').replace(/_/g, ' ');
            });
            const stationConditions = stationNames.map(name => `station_name ILIKE $${paramIndex++}`).join(' OR ');
            conditions.push(`(${stationConditions})`);
            params.push(...stationNames);
        }

        // Filter by parameter name if not 'all'
        if (parameterName && parameterName !== 'all') {
            conditions.push(`parameter_name ILIKE $${paramIndex++}`);
            params.push(`%${parameterName}%`);
        }

        // Filter by date range (with GMT+7 Vietnam timezone)
        if (startDate) {
            // Parse as Vietnam time (GMT+7) - start of day 00:00:00
            const startDateTime = `${startDate}T00:00:00+07:00`;
            conditions.push(`timestamp >= $${paramIndex++}::timestamptz`);
            params.push(startDateTime);
        }

        if (endDate) {
            // Parse as Vietnam time (GMT+7) - end of day 23:59:59
            const endDateTime = `${endDate}T23:59:59+07:00`;
            conditions.push(`timestamp <= $${paramIndex++}::timestamptz`);
            params.push(endDateTime);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Optimized query using time-bucketing and DISTINCT ON
        // Much faster than ROW_NUMBER() window function for large datasets
        // Return timestamp as epoch milliseconds for accurate timezone handling
        const query = `
            WITH time_bucketed AS (
                SELECT 
                    station_name,
                    parameter_name,
                    value,
                    unit,
                    timestamp,
                    FLOOR(EXTRACT(EPOCH FROM timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') / (${interval} * 60)) as time_bucket
                FROM ${table}
                ${whereClause}
                ORDER BY timestamp DESC
                LIMIT ${limit * 2}
            )
            SELECT DISTINCT ON (station_name, parameter_name, time_bucket)
                station_name,
                parameter_name,
                value,
                unit,
                EXTRACT(EPOCH FROM timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::bigint * 1000 as timestamp
            FROM time_bucketed
            ORDER BY station_name, parameter_name, time_bucket DESC, timestamp DESC
            LIMIT $${paramIndex}
        `;
        params.push(limit);

        try {
            const result = await pool.query(query, params);
            
            // Add table type to each row
            const type = table.replace('_data', '').toUpperCase();
            allData.push(...result.rows.map(row => {
                // Generate station_id from station_name and type
                const stationId = `${type.toLowerCase()}_${row.station_name.replace(/\s+/g, '_')}`;
                
                // Timestamp is already in epoch milliseconds (from timezone Asia/Ho_Chi_Minh)
                // JavaScript Date constructor will interpret it correctly
                return {
                    station_name: row.station_name,
                    parameter_name: row.parameter_name,
                    value: row.value,
                    unit: row.unit,
                    timestamp: parseInt(row.timestamp),  // Epoch milliseconds for Vietnam timezone
                    station_id: stationId,
                    type: type
                };
            }));
        } catch (err) {
            console.error(`❌ Lỗi query ${table}:`, err.message);
        }
    }

    // Sort all data by timestamp descending
    allData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Limit total results
    return allData.slice(0, limit);
}

/**
 * Lấy danh sách parameters có sẵn (với cache)
 */
async function getAvailableParameters() {
    const cacheKey = 'available_parameters';
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    
    const result = await pool.query(`
        SELECT DISTINCT parameter_name, 'TVA' as source FROM tva_data
        UNION
        SELECT DISTINCT parameter_name, 'MQTT' as source FROM mqtt_data
        UNION
        SELECT DISTINCT parameter_name, 'SCADA' as source FROM scada_data
        ORDER BY parameter_name
    `);
    
    // Cache for 5 minutes
    cache.set(cacheKey, result.rows, 300);
    return result.rows;
}

/**
 * Lấy danh sách trạm (với cache)
 */
async function getStations() {
    const cacheKey = 'stations_list';
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    
    const result = await pool.query('SELECT * FROM stations ORDER BY station_name');
    
    // Cache for 10 minutes
    cache.set(cacheKey, result.rows, 600);
    return result.rows;
}

/**
 * Xóa dữ liệu cũ
 */
async function cleanOldData(daysToKeep = 90) {
    const tables = ['tva_data', 'mqtt_data', 'scada_data'];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    let totalDeleted = 0;
    
    for (const table of tables) {
        const result = await pool.query(
            `DELETE FROM ${table} WHERE timestamp < $1`,
            [cutoffDate]
        );
        totalDeleted += result.rowCount;
        console.log(`🗑️ Đã xóa ${result.rowCount} records cũ hơn ${daysToKeep} ngày từ ${table}`);
    }
    
    return totalDeleted;
}

/**
 * Kiểm tra các trạm có thay đổi giá trị
 */
/**
 * Kiểm tra trạng thái online/offline của các trạm
 * Trạm được coi là online nếu có dữ liệu được cập nhật trong khoảng thời gian timeoutMinutes
 * @param {number} timeoutMinutes - Thời gian timeout (phút)
 * @returns {Object} Map của station_name => { hasChange, lastUpdate }
 */
/**
 * Kiểm tra trạng thái online/offline của các trạm (với cache)
 * Trạm được coi là ONLINE nếu có dữ liệu cập nhật trong khoảng timeoutMinutes
 * @param {number} timeoutMinutes - Số phút timeout (mặc định 60)
 * @returns {Object} Map chứa status của các trạm
 */
async function checkStationsValueChanges(timeoutMinutes = 60) {
    const cacheKey = `station_status_all`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }
    
    const now = Date.now();
    const cutoffTime = new Date(now - timeoutMinutes * 60 * 1000);
    
    const tables = [
        { name: 'tva_data', type: 'TVA' },
        { name: 'mqtt_data', type: 'MQTT' },
        { name: 'scada_data', type: 'SCADA' }
    ];

    const statusMap = {};
    let totalOnline = 0;
    let totalOffline = 0;

    for (const table of tables) {
        // Return the latest record for EVERY station regardless of age,
        // so long-offline stations (no data in the window) are still detected.
        const query = `
            SELECT DISTINCT ON (station_name)
                station_name,
                timestamp
            FROM ${table.name}
            ORDER BY station_name, timestamp DESC
        `;

        const result = await pool.query(query);
        
        for (const row of result.rows) {
            const stationName = row.station_name;
            const lastUpdate = new Date(row.timestamp);
            const timeDiffMinutes = Math.floor((now - lastUpdate.getTime()) / (60 * 1000));
            
            // Trạm ONLINE nếu có dữ liệu trong khoảng timeout
            const isOnline = lastUpdate > cutoffTime;
            const status = isOnline ? 'online' : 'offline';
            
            // Chỉ update nếu chưa có hoặc timestamp mới hơn
            if (!statusMap[stationName] || new Date(statusMap[stationName].lastUpdate) < lastUpdate) {
                statusMap[stationName] = {
                    status: status,
                    hasChange: isOnline,  // Giữ lại để tương thích ngược
                    lastUpdate: row.timestamp,
                    lastUpdateDate: lastUpdate.toISOString(),
                    timeSinceUpdate: timeDiffMinutes,
                    type: table.type
                };
                
                if (isOnline) totalOnline++;
                else totalOffline++;
            }
        }
    }

    console.log(`🔍 Kiểm tra trạng thái: ${totalOnline} online, ${totalOffline} offline (timeout: ${timeoutMinutes} phút)`);
    
    // Cache for 30 seconds
    cache.set(cacheKey, statusMap, 30);
    return statusMap;
}

/**
 * Lấy thời gian cập nhật cuối cùng của các trạm
 */
async function getStationLastUpdates() {
    const tables = ['tva_data', 'mqtt_data', 'scada_data'];
    const updates = {};

    for (const table of tables) {
        const type = table.replace('_data', '').toUpperCase();
        const result = await pool.query(`
            SELECT DISTINCT ON (station_name)
                station_name,
                timestamp
            FROM ${table}
            ORDER BY station_name, timestamp DESC
        `);

        for (const row of result.rows) {
            if (!updates[row.station_name]) {
                updates[row.station_name] = {};
            }
            updates[row.station_name][type] = {
                timestamp: row.timestamp,
                updateTime: row.timestamp
            };
        }
    }

    return updates;
}

/**
 * Lấy dữ liệu mới nhất của tất cả trạm (grouped by station)
 */
async function getLatestStationsData() {
    const tables = ['tva_data', 'mqtt_data', 'scada_data'];
    const stationsData = {};

    for (const table of tables) {
        const type = table.replace('_data', '').toUpperCase();
        // Optimized query: Use index-friendly approach with subquery
        // This allows PostgreSQL to use idx_<table>_station_param_time efficiently
        const result = await pool.query(`
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                parameter_name,
                value,
                unit,
                timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' as timestamp
            FROM ${table}
            WHERE timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY station_name, parameter_name, timestamp DESC
        `);

        for (const row of result.rows) {
            const stationName = row.station_name;
            
            // Format timestamp for consistency
            let formattedTime = '';
            if (row.timestamp) {
                const date = new Date(row.timestamp);
                formattedTime = date.toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            }
            
            // Khởi tạo station nếu chưa có
            if (!stationsData[stationName]) {
                stationsData[stationName] = {
                    stationName: stationName,
                    type: type,
                    timestamp: row.timestamp,  // ISO timestamp for client processing
                    updateTime: formattedTime,  // Formatted time for display
                    data: []
                };
            }
            
            // Thêm parameter vào data array
            stationsData[stationName].data.push({
                stt: String(stationsData[stationName].data.length + 1),
                name: row.parameter_name,
                value: String(row.value || ''),
                unit: row.unit || '',
                time: formattedTime
            });
        }
    }

    return stationsData;
}

/**
 * Lấy thống kê visitor
 */
async function getVisitorStats() {
    // Ensure pool is initialized
    if (!pool) {
        initPool();
    }

    try {
        const result = await pool.query(`
            SELECT total_visitors, today_date, today_visitors, created_at,
                   (CURRENT_DATE AT TIME ZONE 'Asia/Ho_Chi_Minh')::date as current_date_vietnam
            FROM visitor_stats
            ORDER BY id DESC
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            // Get current date in Vietnam timezone
            const vietnamDate = await pool.query(`SELECT (CURRENT_DATE AT TIME ZONE 'Asia/Ho_Chi_Minh')::date as today`);
            return {
                total_visitors: 20102347,
                today_date: vietnamDate.rows[0].today,
                today_visitors: 0
            };
        }

        return {
            total_visitors: parseInt(result.rows[0].total_visitors),
            today_date: result.rows[0].today_date,
            today_visitors: parseInt(result.rows[0].today_visitors),
            created_at: result.rows[0].created_at
        };
    } catch (error) {
        console.error('❌ Error in getVisitorStats:', error.message);
        // Return fallback data if database is unavailable
        const today = new Date().toISOString().split('T')[0];
        return {
            total_visitors: 20102347,
            today_date: today,
            today_visitors: 0
        };
    }
}

/**
 * Tăng số lượng visitor
 */
async function incrementVisitorCount() {
    // Ensure pool is initialized
    if (!pool) {
        initPool();
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Get current date in Vietnam timezone (GMT+7)
        const currentDateResult = await client.query(`
            SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date as today
        `);
        const todayVietnam = currentDateResult.rows[0].today;

        // Check if visitor_stats table has any records
        const checkResult = await client.query('SELECT COUNT(*) as count FROM visitor_stats');
        
        if (parseInt(checkResult.rows[0].count) === 0) {
            // Insert initial record if table is empty
            const insertResult = await client.query(`
                INSERT INTO visitor_stats (total_visitors, today_date, today_visitors)
                VALUES (20102348, $1, 1)
                RETURNING total_visitors, today_visitors
            `, [todayVietnam]);
            await client.query('COMMIT');
            return insertResult.rows[0];
        }

        const result = await client.query(`
            UPDATE visitor_stats
            SET total_visitors = total_visitors + 1,
                today_visitors = CASE 
                    WHEN today_date = $1 THEN today_visitors + 1
                    ELSE 1
                END,
                today_date = $1
            WHERE id = (SELECT id FROM visitor_stats ORDER BY id DESC LIMIT 1)
            RETURNING total_visitors, today_visitors
        `, [todayVietnam]);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        if (client) {
            await client.query('ROLLBACK');
        }
        console.error('❌ Error incrementing visitor count:', err.message);
        // Return fallback data instead of throwing
        return {
            total_visitors: 20102347,
            today_visitors: 0
        };
    } finally {
        if (client) {
            client.release();
        }
    }
}

/**
 * Set số lượng visitor (admin only)
 */
async function setVisitorCount(totalVisitors) {
    const result = await pool.query(`
        UPDATE visitor_stats
        SET total_visitors = $1
        WHERE id = (SELECT id FROM visitor_stats ORDER BY id DESC LIMIT 1)
        RETURNING total_visitors, today_visitors
    `, [totalVisitors]);

    return result.rows[0];
}

/**
 * Xóa các test stations khỏi database
 */
async function deleteTestStations() {
    initPool();
    
    try {
        // Delete from data tables
        await pool.query("DELETE FROM tva_data WHERE station_name LIKE '%TEST%' OR station_name LIKE '%test%'");
        console.log('✅ Đã xóa test data từ tva_data');
        
        await pool.query("DELETE FROM mqtt_data WHERE station_name LIKE '%TEST%' OR station_name LIKE '%test%'");
        console.log('✅ Đã xóa test data từ mqtt_data');
        
        await pool.query("DELETE FROM scada_data WHERE station_name LIKE '%TEST%' OR station_name LIKE '%test%'");
        console.log('✅ Đã xóa test data từ scada_data');
        
        // Delete from stations table
        const result = await pool.query("DELETE FROM stations WHERE station_name LIKE '%TEST%' OR station_name LIKE '%test%' RETURNING station_name");
        console.log(`✅ Đã xóa ${result.rowCount} test stations từ bảng stations`);
        
        return result.rowCount;
    } catch (err) {
        console.error('❌ Lỗi khi xóa test stations:', err.message);
        throw err;
    }
}

/**
 * Đồng bộ lại timestamp của dữ liệu cũ
 * Chuyển đổi timestamp từ UTC sang múi giờ Việt Nam (GMT+7) nếu cần
 * 
 * LƯU Ý: PostgreSQL TIMESTAMPTZ tự động lưu UTC và chuyển đổi khi query
 * Hàm này chỉ cần thiết nếu muốn chuẩn hóa lại dữ liệu
 */
async function syncTimestamps(options = {}) {
    const {
        dryRun = true,  // Chế độ test, không thực sự update
        tables = ['tva_data', 'mqtt_data', 'scada_data'],
        hoursOffset = null // Nếu null, sẽ kiểm tra và tự động xác định
    } = options;

    const client = await pool.connect();
    
    try {
        console.log('\n🔄 Bắt đầu đồng bộ timestamp...');
        console.log(`📋 Mode: ${dryRun ? 'DRY RUN (không update)' : 'LIVE UPDATE'}`);
        
        // Set timezone cho session
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const table of tables) {
            console.log(`\n📊 Kiểm tra bảng: ${table}`);
            
            // Kiểm tra sample dữ liệu hiện tại
            const sampleQuery = `
                SELECT 
                    id,
                    created_at,
                    created_at AT TIME ZONE 'UTC' as utc_time,
                    created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as vietnam_time,
                    EXTRACT(TIMEZONE_HOUR FROM created_at) as tz_offset
                FROM ${table}
                ORDER BY created_at DESC
                LIMIT 5
            `;
            
            const sample = await client.query(sampleQuery);
            
            if (sample.rows.length === 0) {
                console.log(`  ⚠️ Bảng ${table} không có dữ liệu`);
                continue;
            }
            
            console.log(`  📝 Sample 5 records gần nhất:`);
            sample.rows.forEach((row, idx) => {
                const created = new Date(row.created_at);
                const vietnam = new Date(row.vietnam_time);
                console.log(`    ${idx + 1}. ID: ${row.id}`);
                console.log(`       - Timestamp hiện tại: ${created.toISOString()}`);
                console.log(`       - Hiển thị GMT+7: ${vietnam.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
                console.log(`       - Timezone offset: ${row.tz_offset}h`);
            });
            
            // Đếm tổng số records
            const countResult = await client.query(`SELECT COUNT(*) as total FROM ${table}`);
            const totalRecords = parseInt(countResult.rows[0].total);
            console.log(`  📊 Tổng số records: ${totalRecords.toLocaleString()}`);
            
            // Nếu không phải dry run và cần update
            if (!dryRun && hoursOffset !== null) {
                console.log(`  🔧 Đang điều chỉnh timestamp (${hoursOffset > 0 ? '+' : ''}${hoursOffset}h)...`);
                
                const updateQuery = `
                    UPDATE ${table}
                    SET created_at = created_at + INTERVAL '${hoursOffset} hours'
                    WHERE created_at IS NOT NULL
                `;
                
                const result = await client.query(updateQuery);
                console.log(`  ✅ Đã cập nhật ${result.rowCount} records`);
            }
        }
        
        console.log('\n✅ Hoàn tất kiểm tra timestamp');
        
        if (dryRun) {
            console.log('\n💡 TIP: Chạy với { dryRun: false, hoursOffset: 7 } để update thực sự');
            console.log('   Ví dụ: await syncTimestamps({ dryRun: false, hoursOffset: 7 })');
        }
        
        return true;
    } catch (err) {
        console.error('❌ Lỗi khi đồng bộ timestamp:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Kiểm tra và báo cáo tình trạng timestamp trong database
 */
async function checkTimestampStatus() {
    const client = await pool.connect();
    
    try {
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        console.log('\n🔍 KIỂM TRA TÌNH TRẠNG TIMESTAMP\n');
        
        const tables = ['tva_data', 'mqtt_data', 'scada_data'];
        
        for (const table of tables) {
            console.log(`📊 Bảng: ${table}`);
            
            const query = `
                SELECT 
                    MIN(created_at) as oldest,
                    MAX(created_at) as newest,
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') as last_day
                FROM ${table}
            `;
            
            const result = await client.query(query);
            const row = result.rows[0];
            
            if (parseInt(row.total) === 0) {
                console.log('  ⚠️ Không có dữ liệu\n');
                continue;
            }
            
            const oldest = new Date(row.oldest);
            const newest = new Date(row.newest);
            
            console.log(`  • Tổng records: ${parseInt(row.total).toLocaleString()}`);
            console.log(`  • Record cũ nhất: ${oldest.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
            console.log(`  • Record mới nhất: ${newest.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
            console.log(`  • Records 1 giờ qua: ${parseInt(row.last_hour).toLocaleString()}`);
            console.log(`  • Records 24 giờ qua: ${parseInt(row.last_day).toLocaleString()}`);
            console.log('');
        }
        
        // Kiểm tra timezone setting
        const tzResult = await client.query('SHOW timezone');
        console.log(`⚙️ Timezone hiện tại: ${tzResult.rows[0].TimeZone}`);
        
        const nowResult = await client.query('SELECT NOW() as now, CURRENT_TIMESTAMP as current_ts');
        const now = new Date(nowResult.rows[0].now);
        console.log(`🕐 Thời gian server: ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`);
        
        return true;
    } catch (err) {
        console.error('❌ Lỗi khi kiểm tra timestamp:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Đóng database connection
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        console.log('✅ Đã đóng kết nối PostgreSQL');
    }
}

/**
 * Load all coordinate overrides from database
 * Returns an object: { stationId: { lat, lng }, ... }
 */
async function loadCoordinateOverrides() {
    if (!pool) return {};
    try {
        const result = await pool.query('SELECT station_id, lat, lng FROM coordinate_overrides');
        const overrides = {};
        result.rows.forEach(row => {
            overrides[row.station_id] = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
        });
        return overrides;
    } catch (e) {
        console.error('\u274c loadCoordinateOverrides:', e.message);
        return {};
    }
}

/**
 * Save (upsert) a coordinate override for a station
 */
async function saveCoordinateOverride(stationId, lat, lng) {
    if (!pool) throw new Error('Database not ready');
    await pool.query(`
        INSERT INTO coordinate_overrides (station_id, lat, lng, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (station_id) DO UPDATE SET lat = $2, lng = $3, updated_at = NOW()
    `, [stationId, lat, lng]);
}

/**
 * Delete a coordinate override (reset to default)
 */
async function deleteCoordinateOverride(stationId) {
    if (!pool) throw new Error('Database not ready');
    await pool.query('DELETE FROM coordinate_overrides WHERE station_id = $1', [stationId]);
}

// Khởi tạo pool khi module được load
initPool();

module.exports = {
    initDatabase,
    saveTVAData,
    saveMQTTData,
    saveSCADAData,
    getStatsData,
    getAvailableParameters,
    getStations,
    cleanOldData,
    checkStationsValueChanges,
    getStationLastUpdates,
    getLatestStationsData,
    getVisitorStats,
    incrementVisitorCount,
    setVisitorCount,
    deleteTestStations,
    closeDatabase,
    getVietnamTimestamp,
    syncTimestamps,
    checkTimestampStatus,
    loadCoordinateOverrides,
    saveCoordinateOverride,
    deleteCoordinateOverride,
    pool
};
