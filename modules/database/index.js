/**
 * Database Module - PostgreSQL Operations
 * Module quản lý kết nối và operations với PostgreSQL database
 */

const { Pool } = require('pg');
const config = require('../../config');

let pool;

/**
 * Lấy timestamp hiện tại theo múi giờ GMT+7 (Hồ Chí Minh)
 */
function getVietnamTimestamp() {
    return new Date().toISOString();
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
 * Khởi tạo connection pool
 */
function initPool() {
    if (pool) return pool;

    try {
        pool = new Pool({
            connectionString: config.database.url,
            ssl: config.database.ssl,
            options: config.database.options
        });

        // Set timezone for all connections in the pool
        pool.on('connect', (client) => {
            client.query('SET timezone = \'Asia/Ho_Chi_Minh\'', (err) => {
                if (err) {
                    console.error('❌ Lỗi thiết lập timezone:', err.message);
                }
            });
        });

        // Test connection
        pool.query('SELECT NOW()', (err, res) => {
            if (err) {
                console.error('❌ Lỗi kết nối PostgreSQL database:', err.message);
                process.exit(1);
            } else {
                console.log('✅ Đã kết nối tới PostgreSQL database');
                console.log('🇻🇳 Server time (GMT+7):', res.rows[0].now);
            }
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
                station_id TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ NOT NULL,
                update_time TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng tva_data đã sẵn sàng');
        
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_station ON tva_data(station_name)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_timestamp ON tva_data(timestamp)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_tva_parameter ON tva_data(parameter_name)');

        // Bảng lưu dữ liệu MQTT
        await client.query(`
            CREATE TABLE IF NOT EXISTS mqtt_data (
                id SERIAL PRIMARY KEY,
                station_name TEXT NOT NULL,
                station_id TEXT NOT NULL,
                device_name TEXT,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ NOT NULL,
                update_time TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng mqtt_data đã sẵn sàng');
        
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_station ON mqtt_data(station_name)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_timestamp ON mqtt_data(timestamp)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_mqtt_parameter ON mqtt_data(parameter_name)');

        // Bảng lưu dữ liệu SCADA
        await client.query(`
            CREATE TABLE IF NOT EXISTS scada_data (
                id SERIAL PRIMARY KEY,
                station_name TEXT NOT NULL,
                station_id TEXT NOT NULL,
                parameter_name TEXT NOT NULL,
                value REAL,
                unit TEXT,
                timestamp TIMESTAMPTZ NOT NULL,
                update_time TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng scada_data đã sẵn sàng');
        
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_station ON scada_data(station_name)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_timestamp ON scada_data(timestamp)');
        await client.query('CREATE INDEX IF NOT EXISTS idx_scada_parameter ON scada_data(parameter_name)');

        // Bảng lưu thông tin trạm
        await client.query(`
            CREATE TABLE IF NOT EXISTS stations (
                id SERIAL PRIMARY KEY,
                station_id TEXT UNIQUE NOT NULL,
                station_name TEXT NOT NULL,
                station_type TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng stations đã sẵn sàng');

        // Bảng lưu thống kê visitor
        await client.query(`
            CREATE TABLE IF NOT EXISTS visitor_stats (
                id SERIAL PRIMARY KEY,
                total_visitors BIGINT NOT NULL DEFAULT 20102347,
                today_date DATE NOT NULL DEFAULT CURRENT_DATE,
                today_visitors INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Bảng visitor_stats đã sẵn sàng');
        
        // Khởi tạo giá trị mặc định nếu chưa có
        const visitorCheck = await client.query('SELECT COUNT(*) as count FROM visitor_stats');
        if (parseInt(visitorCheck.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO visitor_stats (total_visitors, today_date, today_visitors)
                VALUES (20102347, CURRENT_DATE, 0)
            `);
            console.log('✅ Khởi tạo visitor_stats với total = 20,102,347');
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
            `INSERT INTO stations (station_id, station_name, station_type, latitude, longitude, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (station_id) 
             DO UPDATE SET 
                station_name = EXCLUDED.station_name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                updated_at = CURRENT_TIMESTAMP`,
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
            const stationTimestamp = (await client.query('SELECT CURRENT_TIMESTAMP as ts')).rows[0].ts;
            const updateTime = stationTimestamp.toISOString();
            
            await saveStationInfo(stationId, station.station, 'TVA', null, null, client);

            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        const cleanValue = parseNumericValue(param.value);
                        await client.query(
                            `INSERT INTO tva_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [station.station, stationId, param.name, cleanValue, param.unit, stationTimestamp, updateTime]
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('tva_data', config.database.maxRecords.tva);
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
            const stationTimestamp = (await client.query('SELECT CURRENT_TIMESTAMP as ts')).rows[0].ts;
            const updateTime = stationTimestamp.toISOString();
            
            await saveStationInfo(stationId, station.station, 'MQTT', station.lat, station.lng, client);

            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        const cleanValue = parseNumericValue(param.value);
                        await client.query(
                            `INSERT INTO mqtt_data (station_name, station_id, device_name, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                            [station.station, stationId, station.deviceName || '', param.name, cleanValue, param.unit, stationTimestamp, updateTime]
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('mqtt_data', config.database.maxRecords.mqtt);
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
            const stationTimestamp = (await client.query('SELECT CURRENT_TIMESTAMP as ts')).rows[0].ts;
            const updateTime = stationTimestamp.toISOString();
            
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
                        await client.query(
                            `INSERT INTO scada_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [station.stationName || station.station, stationId, param.parameterName || param.parameter, 
                             isNaN(numericValue) ? null : numericValue, param.unit || '', stationTimestamp, updateTime]
                        );
                        savedCount++;
                    } catch (err) {
                        console.error(`⚠️ ${station.station} - ${param.parameterName}: ${err.message}`);
                    }
                }
            }
        }
        
        await cleanupOldRecords('scada_data', config.database.maxRecords.scada);
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
    
    for (const table of tables) {
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        // Filter by station IDs if provided
        if (stationIds && stationIds.length > 0) {
            const stationConditions = stationIds.map(id => `station_id = $${paramIndex++}`).join(' OR ');
            conditions.push(`(${stationConditions})`);
            params.push(...stationIds);
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

        // Query with interval sampling to reduce data points
        // Use FLOOR(EXTRACT(EPOCH FROM timestamp) / (interval * 60)) to group by time intervals
        // Return created_at in Vietnam timezone for consistent display
        const query = `
            WITH sampled_data AS (
                SELECT 
                    station_name,
                    station_id,
                    parameter_name,
                    value,
                    unit,
                    created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as timestamp,
                    update_time,
                    ROW_NUMBER() OVER (
                        PARTITION BY 
                            station_id, 
                            parameter_name, 
                            FLOOR(EXTRACT(EPOCH FROM created_at) / (${interval} * 60))
                        ORDER BY created_at DESC
                    ) as rn
                FROM ${table}
                ${whereClause}
            )
            SELECT 
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                timestamp,
                update_time
            FROM sampled_data
            WHERE rn = 1
            ORDER BY timestamp DESC
            LIMIT $${paramIndex}
        `;
        params.push(limit);

        try {
            const result = await pool.query(query, params);
            
            // Add table type to each row
            const type = table.replace('_data', '').toUpperCase();
            allData.push(...result.rows.map(row => {
                // Ensure timestamp is properly formatted for Vietnam timezone
                let formattedTime = '';
                if (row.timestamp) {
                    const date = new Date(row.timestamp);
                    // Format: dd/mm/yyyy HH:mm:ss in Vietnam timezone
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
                
                return {
                    ...row,
                    type: type,
                    timestamp: row.timestamp,
                    time: formattedTime
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
 * Lấy danh sách parameters có sẵn
 */
async function getAvailableParameters() {
    const result = await pool.query(`
        SELECT DISTINCT parameter_name, 'TVA' as source FROM tva_data
        UNION
        SELECT DISTINCT parameter_name, 'MQTT' as source FROM mqtt_data
        UNION
        SELECT DISTINCT parameter_name, 'SCADA' as source FROM scada_data
        ORDER BY parameter_name
    `);
    return result.rows;
}

/**
 * Lấy danh sách trạm
 */
async function getStations() {
    const result = await pool.query('SELECT * FROM stations ORDER BY station_name');
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
 * Kiểm tra trạng thái online/offline của các trạm
 * Trạm được coi là ONLINE nếu có dữ liệu cập nhật trong khoảng timeoutMinutes
 * @param {number} timeoutMinutes - Số phút timeout (mặc định 60)
 * @returns {Object} Map chứa status của các trạm
 */
async function checkStationsValueChanges(timeoutMinutes = 60) {
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
        // Lấy timestamp mới nhất của mỗi trạm
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
                timestamp,
                update_time
            FROM ${table}
            ORDER BY station_name, timestamp DESC
        `);

        for (const row of result.rows) {
            if (!updates[row.station_name]) {
                updates[row.station_name] = {};
            }
            updates[row.station_name][type] = {
                timestamp: row.timestamp,
                updateTime: row.update_time
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
        // Return created_at in Vietnam timezone for consistency with stats display
        const result = await pool.query(`
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' as timestamp,
                update_time
            FROM ${table}
            ORDER BY station_name, parameter_name, created_at DESC
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
                    stationId: row.station_id,
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
    const result = await pool.query(`
        SELECT total_visitors, today_date, today_visitors, updated_at
        FROM visitor_stats
        ORDER BY id DESC
        LIMIT 1
    `);

    if (result.rows.length === 0) {
        return {
            total_visitors: 20102347,
            today_date: new Date().toISOString().split('T')[0],
            today_visitors: 0
        };
    }

    return {
        total_visitors: parseInt(result.rows[0].total_visitors),
        today_date: result.rows[0].today_date,
        today_visitors: parseInt(result.rows[0].today_visitors),
        updated_at: result.rows[0].updated_at
    };
}

/**
 * Tăng số lượng visitor
 */
async function incrementVisitorCount() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Check if visitor_stats table has any records
        const checkResult = await client.query('SELECT COUNT(*) as count FROM visitor_stats');
        
        if (parseInt(checkResult.rows[0].count) === 0) {
            // Insert initial record if table is empty
            const insertResult = await client.query(`
                INSERT INTO visitor_stats (total_visitors, today_date, today_visitors)
                VALUES (20102348, CURRENT_DATE, 1)
                RETURNING total_visitors, today_visitors
            `);
            await client.query('COMMIT');
            return insertResult.rows[0];
        }

        const result = await client.query(`
            UPDATE visitor_stats
            SET total_visitors = total_visitors + 1,
                today_visitors = CASE 
                    WHEN today_date = CURRENT_DATE THEN today_visitors + 1
                    ELSE 1
                END,
                today_date = CURRENT_DATE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT id FROM visitor_stats ORDER BY id DESC LIMIT 1)
            RETURNING total_visitors, today_visitors
        `);

        await client.query('COMMIT');
        return result.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error incrementing visitor count:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Set số lượng visitor (admin only)
 */
async function setVisitorCount(totalVisitors) {
    const result = await pool.query(`
        UPDATE visitor_stats
        SET total_visitors = $1,
            updated_at = CURRENT_TIMESTAMP
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
 * Đóng database connection
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        console.log('✅ Đã đóng kết nối PostgreSQL');
    }
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
    pool
};
