const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Config giới hạn số lượng records (để tránh hết dung lượng)
const MAX_RECORDS = {
    TVA: 100000,    // Giới hạn 100k records cho TVA
    MQTT: 100000,   // Giới hạn 100k records cho MQTT
    SCADA: 100000   // Giới hạn 100k records cho SCADA
};

// Tạo hoặc mở database
const dbPath = path.join(__dirname, 'water_monitoring.db');
let db;

try {
    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
            console.error('❌ Lỗi kết nối database:', err.message);
            console.error('💡 Kiểm tra quyền ghi file và cài đặt sqlite3');
            process.exit(1);
        } else {
            console.log('✅ Đã kết nối tới SQLite database:', dbPath);
        }
    });
} catch (error) {
    console.error('❌ Lỗi khởi tạo SQLite3:', error.message);
    console.error('💡 Đảm bảo sqlite3 đã được cài đặt: npm rebuild --build-from-source sqlite3');
    process.exit(1);
}

/**
 * Khởi tạo các bảng trong database
 */
function initDatabase() {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });

    return new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                // Bảng lưu dữ liệu TVA
                await run(`
                    CREATE TABLE IF NOT EXISTS tva_data (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        station_name TEXT NOT NULL,
                        station_id TEXT NOT NULL,
                        parameter_name TEXT NOT NULL,
                        value REAL,
                        unit TEXT,
                        timestamp DATETIME NOT NULL,
                        update_time TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Bảng tva_data đã sẵn sàng');
                await run('CREATE INDEX IF NOT EXISTS idx_tva_station ON tva_data(station_name)');
                await run('CREATE INDEX IF NOT EXISTS idx_tva_timestamp ON tva_data(timestamp)');
                await run('CREATE INDEX IF NOT EXISTS idx_tva_parameter ON tva_data(parameter_name)');

                // Bảng lưu dữ liệu MQTT
                await run(`
                    CREATE TABLE IF NOT EXISTS mqtt_data (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        station_name TEXT NOT NULL,
                        station_id TEXT NOT NULL,
                        device_name TEXT,
                        parameter_name TEXT NOT NULL,
                        value REAL,
                        unit TEXT,
                        timestamp DATETIME NOT NULL,
                        update_time TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Bảng mqtt_data đã sẵn sàng');
                await run('CREATE INDEX IF NOT EXISTS idx_mqtt_station ON mqtt_data(station_name)');
                await run('CREATE INDEX IF NOT EXISTS idx_mqtt_timestamp ON mqtt_data(timestamp)');
                await run('CREATE INDEX IF NOT EXISTS idx_mqtt_parameter ON mqtt_data(parameter_name)');

                // Bảng lưu dữ liệu SCADA
                await run(`
                    CREATE TABLE IF NOT EXISTS scada_data (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        station_name TEXT NOT NULL,
                        station_id TEXT NOT NULL,
                        parameter_name TEXT NOT NULL,
                        value REAL,
                        unit TEXT,
                        timestamp DATETIME NOT NULL,
                        update_time TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Bảng scada_data đã sẵn sàng');
                await run('CREATE INDEX IF NOT EXISTS idx_scada_station ON scada_data(station_name)');
                await run('CREATE INDEX IF NOT EXISTS idx_scada_timestamp ON scada_data(timestamp)');
                await run('CREATE INDEX IF NOT EXISTS idx_scada_parameter ON scada_data(parameter_name)');

                // Bảng lưu thông tin trạm
                await run(`
                    CREATE TABLE IF NOT EXISTS stations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        station_id TEXT UNIQUE NOT NULL,
                        station_name TEXT NOT NULL,
                        station_type TEXT NOT NULL,
                        latitude REAL,
                        longitude REAL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Bảng stations đã sẵn sàng');

                resolve();
            } catch (err) {
                console.error('❌ Lỗi khởi tạo database:', err.message);
                reject(err);
            }
        });
    });
}

/**
 * Xóa records cũ nhất để giữ trong giới hạn
 */
function cleanupOldRecords(tableName, maxRecords) {
    return new Promise((resolve, reject) => {
        // Đếm số records hiện tại
        db.get(`SELECT COUNT(*) as count FROM ${tableName}`, [], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            const currentCount = row.count;
            if (currentCount <= maxRecords) {
                resolve(0); // Không cần xóa
                return;
            }
            
            // Xóa records cũ nhất (giữ lại maxRecords records mới nhất)
            const deleteCount = currentCount - maxRecords;
            const deleteQuery = `
                DELETE FROM ${tableName}
                WHERE id IN (
                    SELECT id FROM ${tableName}
                    ORDER BY timestamp ASC
                    LIMIT ${deleteCount}
                )
            `;
            
            db.run(deleteQuery, [], function(err) {
                if (err) {
                    console.error(`❌ Lỗi xóa dữ liệu cũ từ ${tableName}:`, err.message);
                    reject(err);
                } else {
                    console.log(`🗑️ Đã xóa ${this.changes} records cũ từ ${tableName} (giữ ${maxRecords} records mới nhất)`);
                    resolve(this.changes);
                }
            });
        });
    });
}

/**
 * Lưu dữ liệu TVA vào database
 */
function saveTVAData(stations) {
    return new Promise((resolve, reject) => {
        if (!stations || stations.length === 0) {
            resolve(0);
            return;
        }

        const timestamp = new Date().toISOString();
        let savedCount = 0;
        let errors = [];

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT INTO tva_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            stations.forEach(station => {
                const stationId = `tva_${station.station.replace(/\s+/g, '_')}`;
                
                // Lưu thông tin trạm
                saveStationInfo(stationId, station.station, 'TVA', null, null);

                // Lưu từng thông số
                if (station.data && Array.isArray(station.data)) {
                    station.data.forEach(param => {
                        stmt.run(
                            station.station,
                            stationId,
                            param.name,
                            param.value,
                            param.unit,
                            timestamp,
                            station.updateTime || timestamp,
                            (err) => {
                                if (err) {
                                    errors.push(`${station.station} - ${param.name}: ${err.message}`);
                                } else {
                                    savedCount++;
                                }
                            }
                        );
                    });
                }
            });

            stmt.finalize(async (err) => {
                if (err) {
                    reject(err);
                } else {
                    if (errors.length > 0) {
                        console.warn(`⚠️ Có ${errors.length} lỗi khi lưu dữ liệu TVA`);
                    }
                    // Cleanup old records nếu vượt giới hạn
                    try {
                        await cleanupOldRecords('tva_data', MAX_RECORDS.TVA);
                    } catch (cleanupErr) {
                        console.error('⚠️ Lỗi cleanup TVA data:', cleanupErr.message);
                    }
                    resolve(savedCount);
                }
            });
        });
    });
}

/**
 * Lưu dữ liệu MQTT vào database
 */
function saveMQTTData(stations) {
    return new Promise((resolve, reject) => {
        if (!stations || stations.length === 0) {
            console.log('⚠️ No MQTT stations to save');
            resolve(0);
            return;
        }

        const timestamp = new Date().toISOString();
        let savedCount = 0;
        let errors = [];

        console.log(`💾 Saving ${stations.length} MQTT stations to database`);

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT INTO mqtt_data (station_name, station_id, device_name, parameter_name, value, unit, timestamp, update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stations.forEach(station => {
                const stationId = `mqtt_${station.station.replace(/\s+/g, '_')}`;
                
                console.log(`   💾 Saving MQTT station: ${station.station} (ID: ${stationId})`);
                
                // Lưu thông tin trạm
                saveStationInfo(stationId, station.station, 'MQTT', station.lat, station.lng);

                // Lưu từng thông số
                if (station.data && Array.isArray(station.data)) {
                    station.data.forEach(param => {
                        stmt.run(
                            station.station,
                            stationId,
                            station.deviceName || '',
                            param.name,
                            param.value,
                            param.unit,
                            timestamp,
                            station.updateTime || timestamp,
                            (err) => {
                                if (err) {
                                    errors.push(`${station.station} - ${param.name}: ${err.message}`);
                                } else {
                                    savedCount++;
                                }
                            }
                        );
                    });
                }
            });

            stmt.finalize(async (err) => {
                if (err) {
                    reject(err);
                } else {
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
                    resolve(savedCount);
                }
            });
        });
    });
}

/**
 * Lưu dữ liệu SCADA vào database
 */
function saveSCADAData(stationsGrouped) {
    return new Promise((resolve, reject) => {
        if (!stationsGrouped || Object.keys(stationsGrouped).length === 0) {
            resolve(0);
            return;
        }

        const timestamp = new Date().toISOString();
        let savedCount = 0;
        let errors = [];

        db.serialize(() => {
            const stmt = db.prepare(`
                INSERT INTO scada_data (station_name, station_id, parameter_name, value, unit, timestamp, update_time)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            Object.values(stationsGrouped).forEach(station => {
                const stationId = `scada_${station.station}`;
                
                // Lưu thông tin trạm (không có lat/lng cho SCADA)
                saveStationInfo(stationId, station.stationName || station.station, 'SCADA', null, null);

                // Lưu từng thông số
                if (station.parameters && Array.isArray(station.parameters)) {
                    station.parameters.forEach(param => {
                        // Parse value từ displayText hoặc value
                        let numericValue = null;
                        if (param.value !== undefined && param.value !== null) {
                            numericValue = typeof param.value === 'number' ? param.value : parseFloat(param.value);
                        } else if (param.displayText) {
                            // Remove commas from displayText (e.g., "703,880" -> 703880)
                            const cleanText = String(param.displayText).replace(/,/g, '');
                            numericValue = parseFloat(cleanText);
                        }

                        stmt.run(
                            station.stationName || station.station,
                            stationId,
                            param.parameterName || param.parameter,
                            isNaN(numericValue) ? null : numericValue,
                            param.unit || '',
                            timestamp,
                            timestamp,
                            (err) => {
                                if (err) {
                                    errors.push(`${station.station} - ${param.parameterName}: ${err.message}`);
                                } else {
                                    savedCount++;
                                }
                            }
                        );
                    });
                }
            });

            stmt.finalize(async (err) => {
                if (err) {
                    reject(err);
                } else {
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
                    resolve(savedCount);
                }
            });
        });
    });
}

/**
 * Lưu hoặc cập nhật thông tin trạm
 */
function saveStationInfo(stationId, stationName, stationType, lat, lng) {
    db.run(`
        INSERT INTO stations (station_id, station_name, station_type, latitude, longitude)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(station_id) DO UPDATE SET
            station_name = excluded.station_name,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            updated_at = CURRENT_TIMESTAMP
    `, [stationId, stationName, stationType, lat, lng], (err) => {
        if (err) {
            console.error(`❌ Lỗi lưu thông tin trạm ${stationId}:`, err.message);
        }
    });
}

/**
 * Lấy dữ liệu thống kê từ database
 */
function getStatsData(options) {
    return new Promise((resolve, reject) => {
        const {
            stationIds = [],
            stationType = 'all', // 'all', 'TVA', 'MQTT'
            parameterName = 'all',
            startDate,
            endDate,
            limit = 10000
        } = options;

        console.log('📊 getStatsData called with:', { stationIds, stationType, parameterName, startDate, endDate, limit });

        let queries = [];
        let params = [];

        // Build separate queries for TVA, MQTT, and SCADA
        if (stationType === 'all' || stationType === 'TVA') {
            let tvaQuery = 'SELECT *, "TVA" as source FROM tva_data WHERE 1=1';
            let tvaParams = [];
            
            if (stationIds.length > 0) {
                const placeholders = stationIds.map(() => '?').join(',');
                tvaQuery += ` AND station_id IN (${placeholders})`;
                tvaParams.push(...stationIds);
            }
            
            if (parameterName !== 'all') {
                // Special handling for pH: match both 'pH' and 'Độ pH'
                if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                    console.log('  🔬 pH filter: matching both "ph" and "độ ph"');
                    tvaQuery += ` AND (parameter_name LIKE '%pH%' OR parameter_name LIKE '%ph%')`;
                } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                    console.log('  💧 Water level filter: matching "Mực Nước" and "Mực nước"');
                    tvaQuery += ` AND (LOWER(parameter_name) LIKE '%mực nước%' OR LOWER(parameter_name) LIKE '%muc nuoc%')`;
                } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                    console.log('  💦 Flow rate filter: matching "Lưu lượng" but excluding "Tổng Lưu Lượng"');
                    tvaQuery += ` AND LOWER(parameter_name) LIKE '%lưu lượng%' AND LOWER(parameter_name) NOT LIKE '%tổng%'`;
                } else {
                    console.log(`  🔬 Parameter filter: ${parameterName}`);
                    tvaQuery += ` AND LOWER(parameter_name) = LOWER(?)`;
                    tvaParams.push(parameterName);
                }
            }
            
            if (startDate) {
                tvaQuery += ` AND timestamp >= ?`;
                tvaParams.push(startDate);
            }
            
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setDate(endDateTime.getDate() + 1);
                tvaQuery += ` AND timestamp < ?`;
                tvaParams.push(endDateTime.toISOString());
            }
            
            queries.push({ query: tvaQuery, params: tvaParams });
        }

        if (stationType === 'all' || stationType === 'MQTT') {
            let mqttQuery = 'SELECT *, "MQTT" as source FROM mqtt_data WHERE 1=1';
            let mqttParams = [];
            
            if (stationIds.length > 0) {
                const placeholders = stationIds.map(() => '?').join(',');
                mqttQuery += ` AND station_id IN (${placeholders})`;
                mqttParams.push(...stationIds);
            }
            
            if (parameterName !== 'all') {
                // Special handling for pH: match both 'pH' and 'Độ pH'
                if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                    mqttQuery += ` AND (parameter_name LIKE '%pH%' OR parameter_name LIKE '%ph%')`;
                } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                    mqttQuery += ` AND (LOWER(parameter_name) LIKE '%mực nước%' OR LOWER(parameter_name) LIKE '%muc nuoc%')`;
                } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                    mqttQuery += ` AND LOWER(parameter_name) LIKE '%lưu lượng%' AND LOWER(parameter_name) NOT LIKE '%tổng%'`;
                } else {
                    mqttQuery += ` AND LOWER(parameter_name) = LOWER(?)`;
                    mqttParams.push(parameterName);
                }
            }
            
            if (startDate) {
                mqttQuery += ` AND timestamp >= ?`;
                mqttParams.push(startDate);
            }
            
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setDate(endDateTime.getDate() + 1);
                mqttQuery += ` AND timestamp < ?`;
                mqttParams.push(endDateTime.toISOString());
            }
            
            queries.push({ query: mqttQuery, params: mqttParams });
        }

        if (stationType === 'all' || stationType === 'SCADA') {
            let scadaQuery = 'SELECT *, "SCADA" as source FROM scada_data WHERE 1=1';
            let scadaParams = [];
            
            if (stationIds.length > 0) {
                const placeholders = stationIds.map(() => '?').join(',');
                scadaQuery += ` AND station_id IN (${placeholders})`;
                scadaParams.push(...stationIds);
            }
            
            if (parameterName !== 'all') {
                // Special handling for pH: match both 'pH' and 'Độ pH'
                if (parameterName.toLowerCase() === 'ph' || parameterName.toLowerCase() === 'độ ph') {
                    console.log('  🔬 pH filter: matching both "ph" and "độ ph"');
                    scadaQuery += ` AND (parameter_name LIKE '%pH%' OR parameter_name LIKE '%ph%')`;
                } else if (parameterName.toLowerCase().includes('mực nước') || parameterName.toLowerCase().includes('muc nuoc')) {
                    console.log('  💧 Water level filter: matching "Mực Nước" and "Mực nước"');
                    scadaQuery += ` AND (LOWER(parameter_name) LIKE '%mực nước%' OR LOWER(parameter_name) LIKE '%muc nuoc%')`;
                } else if (parameterName.toLowerCase().includes('lưu lượng')) {
                    console.log('  💦 Flow rate filter: matching "Lưu lượng" but excluding "Tổng Lưu Lượng"');
                    scadaQuery += ` AND LOWER(parameter_name) LIKE '%lưu lượng%' AND LOWER(parameter_name) NOT LIKE '%tổng%'`;
                } else {
                    console.log(`  🔬 Parameter filter: ${parameterName}`);
                    scadaQuery += ` AND LOWER(parameter_name) = LOWER(?)`;
                    scadaParams.push(parameterName);
                }
            }
            
            if (startDate) {
                scadaQuery += ` AND timestamp >= ?`;
                scadaParams.push(startDate);
            }
            
            if (endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setDate(endDateTime.getDate() + 1);
                scadaQuery += ` AND timestamp < ?`;
                scadaParams.push(endDateTime.toISOString());
            }
            
            queries.push({ query: scadaQuery, params: scadaParams });
        }

        // Execute queries and combine results
        const allResults = [];
        let completed = 0;

        queries.forEach(({ query, params: queryParams }, index) => {
            const queryType = query.includes('"TVA"') ? 'TVA' : query.includes('"MQTT"') ? 'MQTT' : 'SCADA';
            console.log(`🔍 Executing ${queryType} query:`, query);
            console.log('📝 With params:', queryParams);
            
            db.all(query, queryParams, (err, rows) => {
                if (err) {
                    console.error(`❌ ${queryType} query error:`, err);
                } else {
                    console.log(`✅ ${queryType} query returned ${rows.length} rows`);
                    if (rows.length > 0) {
                        console.log(`   Sample ${queryType} record:`, rows[0]);
                    }
                    allResults.push(...rows);
                }
                
                completed++;
                if (completed === queries.length) {
                    // Sort by timestamp and limit
                    allResults.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    console.log(`📊 getStatsData returning ${allResults.length} total records`);
                    if (allResults.length > 0) {
                        console.log('   Sample final record:', allResults[0]);
                    }
                    resolve(allResults.slice(0, limit));
                }
            });
        });

        // Handle case when no queries
        if (queries.length === 0) {
            resolve([]);
        }
    });
}

/**
 * Lấy danh sách các thông số có sẵn
 */
function getAvailableParameters() {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT DISTINCT parameter_name FROM (
                SELECT parameter_name FROM tva_data
                UNION
                SELECT parameter_name FROM mqtt_data
                UNION
                SELECT parameter_name FROM scada_data
            ) ORDER BY parameter_name
        `;

        db.all(query, [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows.map(r => r.parameter_name));
            }
        });
    });
}

/**
 * Lấy danh sách trạm từ database
 */
function getStations() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM stations ORDER BY station_name', [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

/**
 * Xóa dữ liệu cũ (tùy chọn)
 */
function cleanOldData(daysToKeep = 90) {
    return new Promise((resolve, reject) => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffISO = cutoffDate.toISOString();

        db.serialize(() => {
            db.run('DELETE FROM tva_data WHERE timestamp < ?', [cutoffISO]);
            db.run('DELETE FROM mqtt_data WHERE timestamp < ?', [cutoffISO]);
            db.run('DELETE FROM scada_data WHERE timestamp < ?', [cutoffISO], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
}

/**
 * Đóng kết nối database
 */
function closeDatabase() {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) {
                reject(err);
            } else {
                console.log('✅ Đã đóng kết nối database');
                resolve();
            }
        });
    });
}

/**
 * Kiểm tra xem trạm có online hay không (có thay đổi giá trị trong khoảng thời gian)
 * Trả về object: { station_name: { hasChange: true/false, lastUpdate: timestamp } }
 */
function checkStationsValueChanges(timeoutMinutes = 60) {
    return new Promise((resolve, reject) => {
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
            WHERE timestamp >= ?
                AND parameter_name NOT IN ('Tổng Lưu Lượng')
            GROUP BY station_name, parameter_name
        `;
        
        db.all(tvaQuery, [cutoffTime], (err, tvaRows) => {
            if (err) {
                console.error('❌ Error checking TVA value changes:', err);
                reject(err);
                return;
            }
            
            console.log(`📊 TVA query returned ${tvaRows.length} parameter groups`);
            
            // Phân tích kết quả TVA
            tvaRows.forEach(row => {
                if (!results[row.station_name]) {
                    results[row.station_name] = {
                        hasChange: false,
                        lastUpdate: row.last_update,
                        parameters: []
                    };
                }
                
                // Kiểm tra xem parameter này có thay đổi không
                const paramHasChange = row.distinct_values > 1;
                
                results[row.station_name].parameters.push({
                    name: row.parameter_name,
                    distinctValues: row.distinct_values,
                    totalRecords: row.total_records,
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
                WHERE timestamp >= ?
                GROUP BY station_name, parameter_name
            `;
            
            db.all(mqttQuery, [cutoffTime], (err, mqttRows) => {
                if (err) {
                    console.error('❌ Error checking MQTT value changes:', err);
                    reject(err);
                    return;
                }
                
                console.log(`📊 MQTT query returned ${mqttRows.length} parameter groups`);
                
                // Phân tích kết quả MQTT
                mqttRows.forEach(row => {
                    if (!results[row.station_name]) {
                        results[row.station_name] = {
                            hasChange: false,
                            lastUpdate: row.last_update,
                            parameters: []
                        };
                    }
                    
                    // Kiểm tra xem parameter này có thay đổi không
                    const paramHasChange = row.distinct_values > 1;
                    
                    results[row.station_name].parameters.push({
                        name: row.parameter_name,
                        distinctValues: row.distinct_values,
                        totalRecords: row.total_records,
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
                    WHERE timestamp >= ?
                        AND parameter_name NOT IN ('Tổng Lưu Lượng')
                    GROUP BY station_name, parameter_name
                `;
                
                db.all(scadaQuery, [cutoffTime], (err, scadaRows) => {
                    if (err) {
                        console.error('❌ Error checking SCADA value changes:', err);
                        reject(err);
                        return;
                    }
                    
                    console.log(`📊 SCADA query returned ${scadaRows.length} parameter groups`);
                    
                    // Phân tích kết quả SCADA
                    scadaRows.forEach(row => {
                        if (!results[row.station_name]) {
                            results[row.station_name] = {
                                hasChange: false,
                                lastUpdate: row.last_update,
                                parameters: []
                            };
                        }
                        
                        // Kiểm tra xem parameter này có thay đổi không
                        const paramHasChange = row.distinct_values > 1;
                        
                        results[row.station_name].parameters.push({
                            name: row.parameter_name,
                            distinctValues: row.distinct_values,
                            totalRecords: row.total_records,
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
                    
                    resolve(results);
                });
            });
        });
    });
}

/**
 * Get last update time for each station from database
 */
function getStationLastUpdates() {
    return new Promise((resolve, reject) => {
        const lastUpdates = {};
        
        // Get last update from TVA data
        const tvaQuery = `
            SELECT station_name, MAX(timestamp) as last_update
            FROM tva_data
            GROUP BY station_name
        `;
        
        db.all(tvaQuery, [], (err, tvaRows) => {
            if (err) {
                console.error('Error getting TVA last updates:', err);
                reject(err);
                return;
            }
            
            // Store TVA updates
            tvaRows.forEach(row => {
                lastUpdates[row.station_name] = row.last_update;
            });
            
            // Get last update from MQTT data
            const mqttQuery = `
                SELECT station_name, MAX(timestamp) as last_update
                FROM mqtt_data
                GROUP BY station_name
            `;
            
            db.all(mqttQuery, [], (err, mqttRows) => {
                if (err) {
                    console.error('Error getting MQTT last updates:', err);
                    reject(err);
                    return;
                }
                
                // Store MQTT updates (merge with TVA)
                mqttRows.forEach(row => {
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
                
                db.all(scadaQuery, [], (err, scadaRows) => {
                    if (err) {
                        console.error('Error getting SCADA last updates:', err);
                        reject(err);
                        return;
                    }
                    
                    // Store SCADA updates (merge with TVA and MQTT)
                    scadaRows.forEach(row => {
                        if (!lastUpdates[row.station_name] || 
                            new Date(row.last_update) > new Date(lastUpdates[row.station_name])) {
                            lastUpdates[row.station_name] = row.last_update;
                        }
                    });
                    
                    resolve(lastUpdates);
                });
            });
        });
    });
}

/**
 * Get latest data for all stations from database (for map display)
 */
function getLatestStationsData() {
    return new Promise((resolve, reject) => {
        const stationsData = {};
        
        // Get latest data from TVA
        const tvaQuery = `
            SELECT 
                station_name,
                station_id,
                parameter_name,
                value,
                unit,
                MAX(timestamp) as timestamp,
                update_time
            FROM tva_data
            WHERE timestamp >= datetime('now', '-2 hours')
            GROUP BY station_name, parameter_name
            ORDER BY station_name, parameter_name
        `;
        
        db.all(tvaQuery, [], (err, tvaRows) => {
            if (err) {
                console.error('Error getting latest TVA data:', err);
                reject(err);
                return;
            }
            
            // Group TVA data by station
            tvaRows.forEach(row => {
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
                SELECT 
                    station_name,
                    station_id,
                    parameter_name,
                    value,
                    unit,
                    MAX(timestamp) as timestamp,
                    update_time
                FROM mqtt_data
                WHERE timestamp >= datetime('now', '-2 hours')
                GROUP BY station_name, parameter_name
                ORDER BY station_name, parameter_name
            `;
            
            db.all(mqttQuery, [], (err, mqttRows) => {
                if (err) {
                    console.error('Error getting latest MQTT data:', err);
                    reject(err);
                    return;
                }
                
                // Group MQTT data by station
                mqttRows.forEach(row => {
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
                    SELECT 
                        station_name,
                        station_id,
                        parameter_name,
                        value,
                        unit,
                        MAX(timestamp) as timestamp
                    FROM scada_data
                    WHERE timestamp >= datetime('now', '-2 hours')
                    GROUP BY station_name, parameter_name
                    ORDER BY station_name, parameter_name
                `;
                
                db.all(scadaQuery, [], (err, scadaRows) => {
                    if (err) {
                        console.error('Error getting latest SCADA data:', err);
                        reject(err);
                        return;
                    }
                    
                    // Group SCADA data by station
                    scadaRows.forEach(row => {
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
                    
                    resolve(stationsData);
                });
            });
        });
    });
}

module.exports = {
    db,
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
    getLatestStationsData,
    MAX_RECORDS
};
