const { Pool } = require('pg');

// Config giới hạn số lượng records (để tránh hết dung lượng)
const MAX_RECORDS = {
    TVA: 100000,    // Giới hạn 100k records cho TVA
    MQTT: 100000,   // Giới hạn 100k records cho MQTT
    SCADA: 100000   // Giới hạn 100k records cho SCADA
};

/**
 * Lấy timestamp hiện tại theo múi giờ GMT+7 (Hồ Chí Minh)
 * Trả về thời gian hiện tại của server
 */
function getVietnamTimestamp() {
    // Lấy thời gian hiện tại
    // PostgreSQL TIMESTAMPTZ sẽ tự động xử lý timezone khi lưu
    return new Date().toISOString();
}

// Kết nối tới PostgreSQL database
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

let pool;

try {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Cho phép kết nối SSL với Supabase
        },
        // Set timezone mặc định cho tất cả connections
        options: '-c TimeZone=Asia/Ho_Chi_Minh'
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
} catch (error) {
    console.error('❌ Lỗi khởi tạo PostgreSQL:', error.message);
    process.exit(1);
}

/**
 * Khởi tạo các bảng trong database
 */
async function initDatabase() {
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
        // Đếm số records hiện tại
        const countResult = await client.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const currentCount = parseInt(countResult.rows[0].count);
        
        if (currentCount <= maxRecords) {
            return 0; // Không cần xóa
        }
        
        // Xóa records cũ nhất (giữ lại maxRecords records mới nhất)
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
        console.log(`🗑️ Đã xóa ${result.rowCount} records cũ từ ${tableName} (giữ ${maxRecords} records mới nhất)`);
        return result.rowCount;
    } catch (err) {
        console.error(`❌ Lỗi xóa dữ liệu cũ từ ${tableName}:`, err.message);
        throw err;
    } finally {
        client.release();
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
    let errors = [];

    const client = await pool.connect();
    
    try {
        // Set timezone cho connection này - Múi giờ Việt Nam (GMT+7)
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of stations) {
            const stationId = `tva_${station.station.replace(/\s+/g, '_')}`;
            
            // Lưu thông tin trạm
            await saveStationInfo(stationId, station.station, 'TVA', null, null);

            // Lưu từng thông số
            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        // Sử dụng CURRENT_TIMESTAMP của PostgreSQL để lấy thời gian hiện tại
                        await client.query(
                            `INSERT INTO tva_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                            [station.station, stationId, param.name, param.value, param.unit]
                        );
                        savedCount++;
                    } catch (err) {
                        errors.push(`${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            console.warn(`⚠️ Có ${errors.length} lỗi khi lưu dữ liệu TVA`);
        }
        
        // Cleanup old records nếu vượt giới hạn
        try {
            await cleanupOldRecords('tva_data', MAX_RECORDS.TVA);
        } catch (cleanupErr) {
            console.error('⚠️ Lỗi cleanup TVA data:', cleanupErr.message);
        }
        
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
        console.log('⚠️ No MQTT stations to save');
        return 0;
    }

    let savedCount = 0;
    let errors = [];

    console.log(`💾 Saving ${stations.length} MQTT stations to database`);

    const client = await pool.connect();
    
    try {
        // Set timezone cho connection này - Múi giờ Việt Nam (GMT+7)
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of stations) {
            const stationId = `mqtt_${station.station.replace(/\s+/g, '_')}`;
            
            console.log(`   💾 Saving MQTT station: ${station.station} (ID: ${stationId})`);
            
            // Lưu thông tin trạm
            await saveStationInfo(stationId, station.station, 'MQTT', station.lat, station.lng);

            // Lưu từng thông số
            if (station.data && Array.isArray(station.data)) {
                for (const param of station.data) {
                    try {
                        // Sử dụng CURRENT_TIMESTAMP của PostgreSQL để lấy thời gian hiện tại
                        await client.query(
                            `INSERT INTO mqtt_data (station_name, station_id, device_name, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                            [station.station, stationId, station.deviceName || '', param.name, param.value, param.unit]
                        );
                        savedCount++;
                    } catch (err) {
                        errors.push(`${station.station} - ${param.name}: ${err.message}`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            console.warn(`⚠️ Có ${errors.length} lỗi khi lưu dữ liệu MQTT`);
        }
        
        console.log(`✅ Successfully saved ${savedCount} MQTT records`);
        
        // Cleanup old records nếu vượt giới hạn
        try {
            await cleanupOldRecords('mqtt_data', MAX_RECORDS.MQTT);
        } catch (cleanupErr) {
            console.error('⚠️ Lỗi cleanup MQTT data:', cleanupErr.message);
        }
        
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
    let errors = [];

    const client = await pool.connect();
    
    try {
        // Set timezone cho connection này
        await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
        
        for (const station of Object.values(stationsGrouped)) {
            const stationId = `scada_${station.station}`;
            
            // Lưu thông tin trạm (không có lat/lng cho SCADA)
            await saveStationInfo(stationId, station.stationName || station.station, 'SCADA', null, null);

            // Lưu từng thông số
            if (station.parameters && Array.isArray(station.parameters)) {
                for (const param of station.parameters) {
                    // Parse value từ displayText hoặc value
                    let numericValue = null;
                    if (param.value !== undefined && param.value !== null) {
                        numericValue = typeof param.value === 'number' ? param.value : parseFloat(param.value);
                    } else if (param.displayText) {
                        // Remove commas from displayText (e.g., "703,880" -> 703880)
                        const cleanText = String(param.displayText).replace(/,/g, '');
                        numericValue = parseFloat(cleanText);
                    }

                    try {
                        // Sử dụng CURRENT_TIMESTAMP của PostgreSQL để lấy thời gian hiện tại
                        await client.query(
                            `INSERT INTO scada_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                            [station.stationName || station.station, stationId, param.parameterName || param.parameter, 
                             isNaN(numericValue) ? null : numericValue, param.unit || '']
                        );
                        savedCount++;
                    } catch (err) {
                        errors.push(`${station.station} - ${param.parameterName}: ${err.message}`);
                    }
                }
            }
        }

        if (errors.length > 0) {
            console.warn(`⚠️ Có ${errors.length} lỗi khi lưu dữ liệu SCADA`);
        }
        
        console.log(`✅ Đã lưu ${savedCount} bản ghi SCADA vào database`);
        
        // Cleanup old records nếu vượt giới hạn
        try {
            await cleanupOldRecords('scada_data', MAX_RECORDS.SCADA);
        } catch (cleanupErr) {
            console.error('⚠️ Lỗi cleanup SCADA data:', cleanupErr.message);
        }
        
        return savedCount;
    } finally {
        client.release();
    }
}

/**
 * Lưu hoặc cập nhật thông tin trạm
 */
async function saveStationInfo(stationId, stationName, stationType, lat, lng) {
    const client = await pool.connect();
    
    try {
        await client.query(`
            INSERT INTO stations (station_id, station_name, station_type, latitude, longitude)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(station_id) DO UPDATE SET
                station_name = EXCLUDED.station_name,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                updated_at = CURRENT_TIMESTAMP
        `, [stationId, stationName, stationType, lat, lng]);
    } catch (err) {
        console.error(`❌ Lỗi lưu thông tin trạm ${stationId}:`, err.message);
    } finally {
        client.release();
    }
}

/**
 * Lấy dữ liệu thống kê từ database
 */
async function getStatsData(options) {
    const {
        stationIds = [],
        stationType = 'all', // 'all', 'TVA', 'MQTT', 'SCADA'
        parameterName = 'all',
        startDate,
        endDate,
        limit = 10000
    } = options;

    console.log('📊 getStatsData called with:', { stationIds, stationType, parameterName, startDate, endDate, limit });

    let queries = [];

    // Build separate queries for TVA, MQTT, and SCADA
    if (stationType === 'all' || stationType === 'TVA') {
        let tvaQuery = 'SELECT *, \'TVA\' as source FROM tva_data WHERE 1=1';
        let tvaParams = [];
        let paramIndex = 1;
        
        if (stationIds.length > 0) {
            const placeholders = stationIds.map((_, i) => `$${paramIndex++}`).join(',');
            tvaQuery += ` AND station_id IN (${placeholders})`;
            tvaParams.push(...stationIds);
        }
        
        if (parameterName !== 'all') {
            // Special handling for pH: match both 'pH' and 'Độ pH'
            if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                console.log('  🔬 pH filter: matching both "ph" and "độ ph"');
                tvaQuery += ` AND (parameter_name ILIKE '%pH%' OR parameter_name ILIKE '%ph%')`;
            } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                console.log('  💧 Water level filter: matching "Mực Nước" and "Mực nước"');
                tvaQuery += ` AND (parameter_name ILIKE '%mực nước%' OR parameter_name ILIKE '%muc nuoc%')`;
            } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                console.log('  💦 Flow rate filter: matching "Lưu lượng" but excluding "Tổng Lưu Lượng"');
                tvaQuery += ` AND parameter_name ILIKE '%lưu lượng%' AND parameter_name NOT ILIKE '%tổng%'`;
            } else {
                console.log(`  🔬 Parameter filter: ${parameterName}`);
                tvaQuery += ` AND LOWER(parameter_name) = LOWER($${paramIndex++})`;
                tvaParams.push(parameterName);
            }
        }
        
        if (startDate) {
            tvaQuery += ` AND timestamp >= $${paramIndex++}`;
            tvaParams.push(startDate);
        }
        
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setDate(endDateTime.getDate() + 1);
            tvaQuery += ` AND timestamp < $${paramIndex++}`;
            tvaParams.push(endDateTime.toISOString());
        }
        
        queries.push({ query: tvaQuery, params: tvaParams, type: 'TVA' });
    }

    if (stationType === 'all' || stationType === 'MQTT') {
        let mqttQuery = 'SELECT *, \'MQTT\' as source FROM mqtt_data WHERE 1=1';
        let mqttParams = [];
        let paramIndex = 1;
        
        if (stationIds.length > 0) {
            const placeholders = stationIds.map((_, i) => `$${paramIndex++}`).join(',');
            mqttQuery += ` AND station_id IN (${placeholders})`;
            mqttParams.push(...stationIds);
        }
        
        if (parameterName !== 'all') {
            // Special handling for pH: match both 'pH' and 'Độ pH'
            if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                mqttQuery += ` AND (parameter_name ILIKE '%pH%' OR parameter_name ILIKE '%ph%')`;
            } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                mqttQuery += ` AND (parameter_name ILIKE '%mực nước%' OR parameter_name ILIKE '%muc nuoc%')`;
            } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                mqttQuery += ` AND parameter_name ILIKE '%lưu lượng%' AND parameter_name NOT ILIKE '%tổng%'`;
            } else {
                mqttQuery += ` AND LOWER(parameter_name) = LOWER($${paramIndex++})`;
                mqttParams.push(parameterName);
            }
        }
        
        if (startDate) {
            mqttQuery += ` AND timestamp >= $${paramIndex++}`;
            mqttParams.push(startDate);
        }
        
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setDate(endDateTime.getDate() + 1);
            mqttQuery += ` AND timestamp < $${paramIndex++}`;
            mqttParams.push(endDateTime.toISOString());
        }
        
        queries.push({ query: mqttQuery, params: mqttParams, type: 'MQTT' });
    }

    if (stationType === 'all' || stationType === 'SCADA') {
        let scadaQuery = 'SELECT *, \'SCADA\' as source FROM scada_data WHERE 1=1';
        let scadaParams = [];
        let paramIndex = 1;
        
        if (stationIds.length > 0) {
            const placeholders = stationIds.map((_, i) => `$${paramIndex++}`).join(',');
            scadaQuery += ` AND station_id IN (${placeholders})`;
            scadaParams.push(...stationIds);
        }
        
        if (parameterName !== 'all') {
            // Special handling for pH: match both 'pH' and 'Độ pH'
            if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                console.log('  🔬 pH filter: matching both "ph" and "độ ph"');
                scadaQuery += ` AND (parameter_name ILIKE '%pH%' OR parameter_name ILIKE '%ph%')`;
            } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                console.log('  💧 Water level filter: matching "Mực Nước" and "Mực nước"');
                scadaQuery += ` AND (parameter_name ILIKE '%mực nước%' OR parameter_name ILIKE '%muc nuoc%')`;
            } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                console.log('  💦 Flow rate filter: matching "Lưu lượng" but excluding "Tổng Lưu Lượng"');
                scadaQuery += ` AND parameter_name ILIKE '%lưu lượng%' AND parameter_name NOT ILIKE '%tổng%'`;
            } else {
                console.log(`  🔬 Parameter filter: ${parameterName}`);
                scadaQuery += ` AND LOWER(parameter_name) = LOWER($${paramIndex++})`;
                scadaParams.push(parameterName);
            }
        }
        
        if (startDate) {
            scadaQuery += ` AND timestamp >= $${paramIndex++}`;
            scadaParams.push(startDate);
        }
        
        if (endDate) {
            const endDateTime = new Date(endDate);
            endDateTime.setDate(endDateTime.getDate() + 1);
            scadaQuery += ` AND timestamp < $${paramIndex++}`;
            scadaParams.push(endDateTime.toISOString());
        }
        
        queries.push({ query: scadaQuery, params: scadaParams, type: 'SCADA' });
    }

    // Execute queries and combine results
    const allResults = [];

    for (const { query, params, type } of queries) {
        console.log(`🔍 Executing ${type} query:`, query);
        console.log('📝 With params:', params);
        
        try {
            const result = await pool.query(query, params);
            console.log(`✅ ${type} query returned ${result.rows.length} rows`);
            if (result.rows.length > 0) {
                console.log(`   Sample ${type} record:`, result.rows[0]);
            }
            allResults.push(...result.rows);
        } catch (err) {
            console.error(`❌ ${type} query error:`, err);
        }
    }

    // Sort by timestamp and limit
    allResults.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    console.log(`📊 getStatsData returning ${allResults.length} total records`);
    if (allResults.length > 0) {
        console.log('   Sample final record:', allResults[0]);
    }
    
    return allResults.slice(0, limit);
}

/**
 * Lấy danh sách các thông số có sẵn
 */
async function getAvailableParameters() {
    const query = `
        SELECT DISTINCT parameter_name FROM (
            SELECT parameter_name FROM tva_data
            UNION
            SELECT parameter_name FROM mqtt_data
            UNION
            SELECT parameter_name FROM scada_data
        ) AS combined ORDER BY parameter_name
    `;

    const result = await pool.query(query);
    return result.rows.map(r => r.parameter_name);
}

/**
 * Lấy danh sách trạm từ database
 */
async function getStations() {
    const result = await pool.query('SELECT * FROM stations ORDER BY station_name');
    return result.rows;
}

/**
 * Xóa dữ liệu cũ (tùy chọn)
 */
async function cleanOldData(daysToKeep = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffISO = cutoffDate.toISOString();

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM tva_data WHERE timestamp < $1', [cutoffISO]);
        await client.query('DELETE FROM mqtt_data WHERE timestamp < $1', [cutoffISO]);
        await client.query('DELETE FROM scada_data WHERE timestamp < $1', [cutoffISO]);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Đóng kết nối database
 */
async function closeDatabase() {
    await pool.end();
    console.log('✅ Đã đóng kết nối database');
}

/**
 * Kiểm tra xem trạm có online hay không (có thay đổi giá trị trong khoảng thời gian)
 * Trả về object: { station_name: { hasChange: true/false, lastUpdate: timestamp } }
 */
async function checkStationsValueChanges(timeoutMinutes = 60) {
    const results = {};
    const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
    const now = new Date();
    
    console.log(`🔍 Checking value changes for stations (timeout: ${timeoutMinutes} min, cutoff: ${cutoffTime})`);
    
    // Query để lấy danh sách tất cả các trạm có dữ liệu
    // Kiểm tra:
    // 1. Timestamp mới nhất của station
    // 2. Có thay đổi giá trị trong khoảng timeout hay không
    const tvaQuery = `
        SELECT 
            station_name,
            parameter_name,
            COUNT(DISTINCT value) as distinct_values,
            MAX(timestamp) as last_update,
            MIN(timestamp) as first_update,
            COUNT(*) as total_records
        FROM tva_data
        WHERE timestamp >= $1
            AND parameter_name NOT IN ('Tổng Lưu Lượng')
        GROUP BY station_name, parameter_name
    `;
    
    try {
        const tvaResult = await pool.query(tvaQuery, [cutoffTime]);
        console.log(`📊 TVA query returned ${tvaResult.rows.length} parameter groups`);
        
        // Phân tích kết quả TVA
        tvaResult.rows.forEach(row => {
            if (!results[row.station_name]) {
                results[row.station_name] = {
                    hasChange: false,
                    lastUpdate: row.last_update,
                    parameters: []
                };
            }
            
            // Kiểm tra xem parameter này có thay đổi không
            const paramHasChange = parseInt(row.distinct_values) > 1;
            
            results[row.station_name].parameters.push({
                name: row.parameter_name,
                distinctValues: parseInt(row.distinct_values),
                totalRecords: parseInt(row.total_records),
                hasChange: paramHasChange
            });
            
            // Nếu có ít nhất 1 parameter thay đổi -> station có thay đổi
            if (paramHasChange) {
                results[row.station_name].hasChange = true;
            }
            
            // Update last_update nếu mới hơn
            if (new Date(row.last_update) > new Date(results[row.station_name].lastUpdate)) {
                results[row.station_name].lastUpdate = row.last_update;
            }
        });
        
        // Kiểm tra MQTT data
        const mqttQuery = `
            SELECT 
                station_name,
                parameter_name,
                COUNT(DISTINCT value) as distinct_values,
                MAX(timestamp) as last_update,
                MIN(timestamp) as first_update,
                COUNT(*) as total_records
            FROM mqtt_data
            WHERE timestamp >= $1
            GROUP BY station_name, parameter_name
        `;
        
        const mqttResult = await pool.query(mqttQuery, [cutoffTime]);
        console.log(`📊 MQTT query returned ${mqttResult.rows.length} parameter groups`);
        
        // Phân tích kết quả MQTT
        mqttResult.rows.forEach(row => {
            if (!results[row.station_name]) {
                results[row.station_name] = {
                    hasChange: false,
                    lastUpdate: row.last_update,
                    parameters: []
                };
            }
            
            // Kiểm tra xem parameter này có thay đổi không
            const paramHasChange = parseInt(row.distinct_values) > 1;
            
            results[row.station_name].parameters.push({
                name: row.parameter_name,
                distinctValues: parseInt(row.distinct_values),
                totalRecords: parseInt(row.total_records),
                hasChange: paramHasChange
            });
            
            // Nếu có ít nhất 1 parameter thay đổi -> station có thay đổi
            if (paramHasChange) {
                results[row.station_name].hasChange = true;
            }
            
            // Update last_update nếu mới hơn
            if (new Date(row.last_update) > new Date(results[row.station_name].lastUpdate)) {
                results[row.station_name].lastUpdate = row.last_update;
            }
        });
        
        // Kiểm tra SCADA data
        const scadaQuery = `
            SELECT 
                station_name,
                parameter_name,
                COUNT(DISTINCT value) as distinct_values,
                MAX(timestamp) as last_update,
                MIN(timestamp) as first_update,
                COUNT(*) as total_records
            FROM scada_data
            WHERE timestamp >= $1
                AND parameter_name NOT IN ('Tổng Lưu Lượng')
            GROUP BY station_name, parameter_name
        `;
        
        const scadaResult = await pool.query(scadaQuery, [cutoffTime]);
        console.log(`📊 SCADA query returned ${scadaResult.rows.length} parameter groups`);
        
        // Phân tích kết quả SCADA
        scadaResult.rows.forEach(row => {
            if (!results[row.station_name]) {
                results[row.station_name] = {
                    hasChange: false,
                    lastUpdate: row.last_update,
                    parameters: []
                };
            }
            
            // Kiểm tra xem parameter này có thay đổi không
            const paramHasChange = parseInt(row.distinct_values) > 1;
            
            results[row.station_name].parameters.push({
                name: row.parameter_name,
                distinctValues: parseInt(row.distinct_values),
                totalRecords: parseInt(row.total_records),
                hasChange: paramHasChange
            });
            
            // Nếu có ít nhất 1 parameter thay đổi -> station có thay đổi
            if (paramHasChange) {
                results[row.station_name].hasChange = true;
            }
            
            // Update last_update nếu mới hơn
            if (new Date(row.last_update) > new Date(results[row.station_name].lastUpdate)) {
                results[row.station_name].lastUpdate = row.last_update;
            }
        });
        
        // Log kết quả trước khi áp dụng logic kiểm tra timeout
        console.log(`📈 Station status before timeout check:`);
        Object.keys(results).forEach(stationName => {
            const station = results[stationName];
            const changedParams = station.parameters.filter(p => p.hasChange);
            console.log(`   ${stationName}: hasChange=${station.hasChange}, lastUpdate=${station.lastUpdate}, params=${changedParams.length}/${station.parameters.length}`);
        });
        
        // Áp dụng logic: kiểm tra thời gian log dữ liệu trong SQL với thời gian hiện tại
        // Nếu lớn hơn khoảng thời gian cài đặt MÀ dữ liệu không có sự thay đổi → OFFLINE
        Object.keys(results).forEach(stationName => {
            const station = results[stationName];
            
            if (station.lastUpdate) {
                const lastUpdateTime = new Date(station.lastUpdate);
                const timeDiffMinutes = (now - lastUpdateTime) / (1000 * 60);
                
                // Logic mới:
                // - Nếu thời gian từ lần cập nhật cuối > timeout VÀ không có thay đổi → OFFLINE
                // - Nếu thời gian từ lần cập nhật cuối > timeout NHƯNG có thay đổi → ONLINE (dữ liệu cũ nhưng có biến đổi)
                // - Nếu thời gian từ lần cập nhật cuối <= timeout → ONLINE (dữ liệu mới)
                if (timeDiffMinutes > timeoutMinutes && !station.hasChange) {
                    // Dữ liệu cũ và không có thay đổi → OFFLINE
                    station.hasChange = false;
                    console.log(`   ⚠️ ${stationName}: OFFLINE (last update ${timeDiffMinutes.toFixed(1)}min ago, no changes)`);
                } else if (timeDiffMinutes > timeoutMinutes && station.hasChange) {
                    // Dữ liệu cũ nhưng có thay đổi → vẫn coi là ONLINE
                    station.hasChange = true;
                    console.log(`   ℹ️ ${stationName}: ONLINE (last update ${timeDiffMinutes.toFixed(1)}min ago, but has changes)`);
                } else {
                    // Dữ liệu mới → ONLINE
                    station.hasChange = true;
                    console.log(`   ✅ ${stationName}: ONLINE (last update ${timeDiffMinutes.toFixed(1)}min ago)`);
                }
            } else {
                // Không có thông tin cập nhật → OFFLINE
                station.hasChange = false;
                console.log(`   ❌ ${stationName}: OFFLINE (no update info)`);
            }
        });
        
        // Log kết quả cuối cùng
        console.log(`📊 Final station status summary:`);
        Object.keys(results).forEach(stationName => {
            const station = results[stationName];
            console.log(`   ${stationName}: ${station.hasChange ? '✅ ONLINE' : '❌ OFFLINE'}`);
        });
        
        return results;
    } catch (err) {
        console.error('❌ Error checking station value changes:', err);
        throw err;
    }
}

/**
 * Get last update time for each station from database
 */
async function getStationLastUpdates() {
    const lastUpdates = {};
    
    try {
        // Get last update from TVA data
        const tvaQuery = `
            SELECT station_name, MAX(timestamp) as last_update
            FROM tva_data
            GROUP BY station_name
        `;
        
        const tvaResult = await pool.query(tvaQuery);
        
        // Store TVA updates
        tvaResult.rows.forEach(row => {
            lastUpdates[row.station_name] = row.last_update;
        });
        
        // Get last update from MQTT data
        const mqttQuery = `
            SELECT station_name, MAX(timestamp) as last_update
            FROM mqtt_data
            GROUP BY station_name
        `;
        
        const mqttResult = await pool.query(mqttQuery);
        
        // Store MQTT updates (merge with TVA)
        mqttResult.rows.forEach(row => {
            if (!lastUpdates[row.station_name] || 
                new Date(row.last_update) > new Date(lastUpdates[row.station_name])) {
                lastUpdates[row.station_name] = row.last_update;
            }
        });
        
        // Get last update from SCADA data
        const scadaQuery = `
            SELECT station_name, MAX(timestamp) as last_update
            FROM scada_data
            GROUP BY station_name
        `;
        
        const scadaResult = await pool.query(scadaQuery);
        
        // Store SCADA updates (merge with TVA and MQTT)
        scadaResult.rows.forEach(row => {
            if (!lastUpdates[row.station_name] || 
                new Date(row.last_update) > new Date(lastUpdates[row.station_name])) {
                lastUpdates[row.station_name] = row.last_update;
            }
        });
        
        return lastUpdates;
    } catch (err) {
        console.error('Error getting station last updates:', err);
        throw err;
    }
}

/**
 * Get latest data for all stations from database (for map display)
 */
async function getLatestStationsData() {
    const stationsData = {};
    
    try {
        // Get latest data from TVA
        const tvaQuery = `
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                timestamp,
                update_time
            FROM tva_data
            WHERE timestamp >= NOW() - INTERVAL '2 hours'
            ORDER BY station_name, parameter_name, timestamp DESC
        `;
        
        const tvaResult = await pool.query(tvaQuery);
        
        // Group TVA data by station
        tvaResult.rows.forEach(row => {
            if (!stationsData[row.station_name]) {
                stationsData[row.station_name] = {
                    station: row.station_name,
                    type: 'TVA',
                    data: [],
                    updateTime: row.update_time,
                    timestamp: row.timestamp
                };
            }
            
            stationsData[row.station_name].data.push({
                name: row.parameter_name,
                value: row.value,
                unit: row.unit
            });
        });
        
        // Get latest data from MQTT
        const mqttQuery = `
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                timestamp,
                update_time
            FROM mqtt_data
            WHERE timestamp >= NOW() - INTERVAL '2 hours'
            ORDER BY station_name, parameter_name, timestamp DESC
        `;
        
        const mqttResult = await pool.query(mqttQuery);
        
        // Group MQTT data by station
        mqttResult.rows.forEach(row => {
            if (!stationsData[row.station_name]) {
                stationsData[row.station_name] = {
                    station: row.station_name,
                    type: 'MQTT',
                    data: [],
                    updateTime: row.update_time,
                    timestamp: row.timestamp
                };
            }
            
            stationsData[row.station_name].data.push({
                name: row.parameter_name,
                value: row.value,
                unit: row.unit
            });
        });
        
        // Get latest data from SCADA
        const scadaQuery = `
            SELECT DISTINCT ON (station_name, parameter_name)
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                timestamp
            FROM scada_data
            WHERE timestamp >= NOW() - INTERVAL '2 hours'
            ORDER BY station_name, parameter_name, timestamp DESC
        `;
        
        const scadaResult = await pool.query(scadaQuery);
        
        // Group SCADA data by station
        scadaResult.rows.forEach(row => {
            if (!stationsData[row.station_name]) {
                stationsData[row.station_name] = {
                    station: row.station_name,
                    type: 'SCADA',
                    data: [],
                    timestamp: row.timestamp
                };
            }
            
            stationsData[row.station_name].data.push({
                name: row.parameter_name,
                value: row.value,
                unit: row.unit
            });
        });
        
        return stationsData;
    } catch (err) {
        console.error('Error getting latest stations data:', err);
        throw err;
    }
}

// Để tương thích với code cũ, export pool như biến db
const db = pool;

module.exports = {
    db,
    pool,
    initDatabase,
    saveTVAData,
    saveMQTTData,
    saveSCADAData,
    getStatsData,
    getAvailableParameters,
    getStations,
    saveStationInfo,
    cleanOldData,
    cleanupOldRecords,
    closeDatabase,
    checkStationsValueChanges,
    getStationLastUpdates,
    getLatestStationsData,
    MAX_RECORDS
};
