const mqtt = require('mqtt');
const fs = require('fs');
const { MQTT_STATION_COORDINATES } = require('./mqtt-coordinates');

// Cấu hình MQTT Broker
const MQTT_BROKER = 'mqtt://14.225.252.85';
const MQTT_PORT = 1883;
const MQTT_TOPIC = 'telemetry';

// Mapping tên thiết bị sang tên trạm
const DEVICE_NAME_MAP = {
    'G15': 'GIẾNG SỐ 15',
    'G18': 'GIẾNG SỐ 18',
    'G29A': 'GIẾNG SỐ 29A',
    'G30A': 'GIẾNG SỐ 30A',
    'G31B': 'GIẾNG SỐ 31B',
    'GS1_NM2': 'NHÀ MÁY SỐ 1 - GIẾNG SỐ 2',
    'GS2_NM1': 'NHÀ MÁY SỐ 2 - GIẾNG SỐ 1',
    'GTACVAN': 'GIẾNG TẮC VẠN',
    'QT1_NM2': 'QT1-NM2 (Quan trắc NM2)',
    'QT2': 'QT2 (182/GP-BTNMT)',
    'QT2_NM2': 'QT2-NM2 (Quan trắc NM2)',
    'QT2M': 'QT2 (182/GP-BTNMT)',
    'QT4': 'QT4 (Quan trắc)',
    'QT5': 'QT5 (Quan trắc)',
    'LUULUONG1': 'TRẠM ĐO LƯU LƯỢNG 1'
};

// Mapping tên thông số
const PARAMETER_NAME_MAP = {
    'LUULUONG': 'Lưu lượng',
    'MUCNUOC': 'Mực nước',
    'NHIETDO': 'Nhiệt độ nước',
    'TONGLUULUONG': 'Tổng lưu lượng'
};

// Cache dữ liệu
let cachedData = {
    timestamp: new Date().toISOString(),
    totalStations: 0,
    stations: [],
    deviceGroups: {} // Lưu dữ liệu theo device
};

let mqttClient = null;
let isConnected = false;

/**
 * Lấy đơn vị cho từng loại thông số
 */
function getUnit(parameterType) {
    const units = {
        'LUULUONG': 'm³/h',
        'MUCNUOC': 'm',
        'NHIETDO': '°C',
        'TONGLUULUONG': 'm³'
    };
    return units[parameterType] || '';
}

/**
 * Format giới hạn min-max
 */
function formatLimit(min, max) {
    if (min !== undefined && max !== undefined) {
        return `${min} - ${max}`;
    } else if (max !== undefined) {
        return `< ${max}`;
    } else if (min !== undefined) {
        return `> ${min}`;
    }
    return '';
}

/**
 * Xử lý dữ liệu MQTT message
 */
function processMessage(message) {
    try {
        const payload = JSON.parse(message);
        
        // Bỏ qua message không phải data
        if (!payload.d || !Array.isArray(payload.d)) {
            return;
        }
        
        console.log('📨 Nhận dữ liệu MQTT:', payload.d.length, 'thông số');
        
        // Lấy timestamp
        const timestamp = payload.ts || new Date().toISOString();
        
        // Xử lý từng tag trong message
        payload.d.forEach(item => {
            const tag = item.tag;
            const value = item.value;
            
            if (!tag || value === undefined) return;
            
            // Parse tag: G30A_MUCNUOC -> deviceCode: G30A, parameterType: MUCNUOC
            const parts = tag.split('_');
            let deviceCode = parts[0];
            let parameterType = parts.slice(1).join('_');
            
            // Xử lý trường hợp đặc biệt (GS1_NM2, GS2_NM1, etc.)
            if (parts.length > 2 && (parts[0] === 'GS1' || parts[0] === 'GS2' || parts[0] === 'QT1' || parts[0] === 'QT2')) {
                deviceCode = parts[0] + '_' + parts[1];
                parameterType = parts.slice(2).join('_');
            }
            
            // Khởi tạo device group nếu chưa có
            if (!cachedData.deviceGroups) {
                cachedData.deviceGroups = {};
            }
            
            if (!cachedData.deviceGroups[deviceCode]) {
                cachedData.deviceGroups[deviceCode] = {
                    deviceCode: deviceCode,
                    lastUpdate: timestamp,
                    parameters: {}
                };
            }
            
            // Cập nhật parameter
            cachedData.deviceGroups[deviceCode].parameters[parameterType] = {
                name: PARAMETER_NAME_MAP[parameterType] || parameterType,
                time: new Date(timestamp).toLocaleString('vi-VN'),
                value: value,
                unit: getUnit(parameterType),
                rawType: parameterType,
                timestamp: timestamp
            };
            
            // Cập nhật lastUpdate
            cachedData.deviceGroups[deviceCode].lastUpdate = timestamp;
        });
        
        // Chuyển đổi sang format cuối cùng
        updateStationsFormat();

    } catch (error) {
        console.error('❌ Lỗi khi xử lý message:', error.message);
    }
}

/**
 * Chuyển đổi deviceGroups sang format stations
 */
function updateStationsFormat() {
    const stations = [];
    
    if (!cachedData.deviceGroups) return;
    
    for (const deviceCode in cachedData.deviceGroups) {
        const device = cachedData.deviceGroups[deviceCode];
        const stationName = DEVICE_NAME_MAP[deviceCode] || deviceCode;
        
        const parameters = Object.values(device.parameters);
        
        if (parameters.length > 0) {
            // Lấy tọa độ từ config
            const coords = MQTT_STATION_COORDINATES[deviceCode];
            
            // Kiểm tra và cảnh báo nếu thiếu tọa độ
            if (!coords) {
                console.warn(`⚠️ Thiếu tọa độ cho trạm ${deviceCode} (${stationName})`);
            }
            
            stations.push({
                station: stationName,
                updateTime: device.lastUpdate || new Date().toISOString(), // Lưu dạng ISO để dễ parse
                lat: coords?.lat,
                lng: coords?.lng,
                data: parameters.map((param, index) => ({
                    stt: String(index + 1),
                    name: param.name,
                    time: param.time,
                    value: String(param.value),
                    unit: param.unit,
                    limit: ''
                }))
            });
        }
    }

    // Cập nhật cache
    cachedData.timestamp = new Date().toISOString();
    cachedData.totalStations = stations.length;
    cachedData.stations = stations;

    // Lưu vào file
    try {
        fs.writeFileSync('data_mqtt.json', JSON.stringify(cachedData, null, 2), 'utf8');
        console.log(`✅ Đã cập nhật ${cachedData.totalStations} trạm`);
    } catch (error) {
        console.error('⚠️ Lỗi lưu file:', error.message);
    }
}

/**
 * Kết nối đến MQTT broker
 */
function connectMQTT() {
    return new Promise((resolve, reject) => {
        console.log(`🔌 Đang kết nối đến MQTT broker: ${MQTT_BROKER}:${MQTT_PORT}`);
        
        mqttClient = mqtt.connect(MQTT_BROKER, {
            port: MQTT_PORT,
            clean: true,
            connectTimeout: 10000,
            clientId: 'nodejs_mqtt_client_' + Math.random().toString(16).substr(2, 8),
            reconnectPeriod: 5000
        });

        mqttClient.on('connect', () => {
            console.log('✅ Đã kết nối MQTT broker');
            isConnected = true;
            
            // Subscribe vào topic
            mqttClient.subscribe(MQTT_TOPIC, (err) => {
                if (err) {
                    console.error('❌ Lỗi subscribe topic:', err);
                    reject(err);
                } else {
                    console.log(`📡 Đã subscribe vào topic: ${MQTT_TOPIC}`);
                    resolve();
                }
            });
        });

        mqttClient.on('message', (topic, message) => {
            console.log(`\n📩 Nhận message từ topic: ${topic}`);
            processMessage(message.toString());
        });

        mqttClient.on('error', (error) => {
            console.error('❌ Lỗi MQTT:', error.message);
            isConnected = false;
        });

        mqttClient.on('offline', () => {
            console.log('⚠️ MQTT offline, đang thử kết nối lại...');
            isConnected = false;
        });

        mqttClient.on('reconnect', () => {
            console.log('🔄 Đang reconnect MQTT...');
        });

        // Timeout nếu không kết nối được sau 10s
        setTimeout(() => {
            if (!isConnected) {
                reject(new Error('Timeout kết nối MQTT'));
            }
        }, 10000);
    });
}

/**
 * Lấy dữ liệu từ cache
 */
function getStationsData() {
    // Đọc từ file nếu có
    if (fs.existsSync('data_mqtt.json')) {
        try {
            const fileData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
            
            // Kiểm tra xem dữ liệu có cũ hơn 10 phút không
            const dataAge = Date.now() - new Date(fileData.timestamp).getTime();
            const tenMinutes = 10 * 60 * 1000;
            
            if (dataAge < tenMinutes) {
                return fileData;
            }
        } catch (error) {
            console.error('⚠️ Lỗi đọc file cache:', error.message);
        }
    }
    
    return cachedData;
}

/**
 * Ngắt kết nối MQTT
 */
function disconnect() {
    if (mqttClient) {
        mqttClient.end();
        console.log('👋 Đã ngắt kết nối MQTT');
    }
}

/**
 * Kiểm tra trạng thái kết nối
 */
function getConnectionStatus() {
    return {
        connected: isConnected,
        lastUpdate: cachedData.timestamp,
        totalStations: cachedData.totalStations
    };
}

/**
 * In dữ liệu TVA từ file data_quantrac.json
 */
function printTVAData() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                          DỮ LIỆU TRẠM TVA                                ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
    
    try {
        if (!fs.existsSync('data_quantrac.json')) {
            console.log('❌ Không tìm thấy file data_quantrac.json');
            return;
        }
        
        const tvaData = JSON.parse(fs.readFileSync('data_quantrac.json', 'utf8'));
        
        console.log(`📅 Thời gian cập nhật: ${tvaData.timestamp}`);
        console.log(`📊 Tổng số trạm: ${tvaData.totalStations}\n`);
        
        tvaData.stations.forEach((station, index) => {
            console.log(`\n${index + 1}. 🏭 ${station.station}`);
            console.log(`   ⏰ Cập nhật: ${station.updateTime}`);
            
            if (station.data && station.data.length > 0) {
                console.log('   ┌─────┬────────────────────────┬─────────┬────────────────┬──────────┬─────────────┐');
                console.log('   │ STT │ Tên thông số           │ Giờ đo  │ Giá trị        │ Đơn vị   │ Giới hạn    │');
                console.log('   ├─────┼────────────────────────┼─────────┼────────────────┼──────────┼─────────────┤');
                
                station.data.forEach(param => {
                    console.log(`   │ ${param.stt.padEnd(3)} │ ${param.name.padEnd(22)} │ ${param.time.padEnd(7)} │ ${param.value.padEnd(14)} │ ${param.unit.padEnd(8)} │ ${param.limit.padEnd(11)} │`);
                });
                
                console.log('   └─────┴────────────────────────┴─────────┴────────────────┴──────────┴─────────────┘');
            } else {
                console.log('   ⚠️  Không có dữ liệu');
            }
        });
        
        console.log('\n' + '═'.repeat(79));
        
    } catch (error) {
        console.error('❌ Lỗi khi đọc dữ liệu TVA:', error.message);
    }
}

/**
 * In dữ liệu MQTT từ file data_mqtt.json
 */
function printMQTTData() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                         DỮ LIỆU TRẠM MQTT                                ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
    
    try {
        if (!fs.existsSync('data_mqtt.json')) {
            console.log('❌ Không tìm thấy file data_mqtt.json');
            console.log('💡 Hãy chạy MQTT client để thu thập dữ liệu trước.');
            return;
        }
        
        const mqttData = JSON.parse(fs.readFileSync('data_mqtt.json', 'utf8'));
        
        console.log(`📅 Thời gian cập nhật: ${mqttData.timestamp}`);
        console.log(`📊 Tổng số trạm: ${mqttData.totalStations}\n`);
        
        mqttData.stations.forEach((station, index) => {
            console.log(`\n${index + 1}. 📡 ${station.station}`);
            console.log(`   ⏰ Cập nhật: ${station.updateTime}`);
            
            if (station.lat && station.lng) {
                console.log(`   📍 Tọa độ: ${station.lat}, ${station.lng}`);
            }
            
            if (station.data && station.data.length > 0) {
                console.log('   ┌─────┬────────────────────────┬──────────────────────┬────────────────┬──────────┐');
                console.log('   │ STT │ Tên thông số           │ Giờ đo               │ Giá trị        │ Đơn vị   │');
                console.log('   ├─────┼────────────────────────┼──────────────────────┼────────────────┼──────────┤');
                
                station.data.forEach(param => {
                    console.log(`   │ ${param.stt.padEnd(3)} │ ${param.name.padEnd(22)} │ ${param.time.padEnd(20)} │ ${param.value.padEnd(14)} │ ${param.unit.padEnd(8)} │`);
                });
                
                console.log('   └─────┴────────────────────────┴──────────────────────┴────────────────┴──────────┘');
            } else {
                console.log('   ⚠️  Không có dữ liệu');
            }
        });
        
        console.log('\n' + '═'.repeat(79));
        
    } catch (error) {
        console.error('❌ Lỗi khi đọc dữ liệu MQTT:', error.message);
    }
}

/**
 * In tất cả dữ liệu từ cả TVA và MQTT
 */
function printAllData() {
    console.clear();
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║              BÁO CÁO DỮ LIỆU TRẠM QUAN TRẮC TVA & MQTT                  ║');
    console.log('║                     ' + new Date().toLocaleString('vi-VN').padEnd(49) + '║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
    
    // In dữ liệu TVA
    printTVAData();
    
    // In dữ liệu MQTT
    printMQTTData();
    
    console.log('\n✅ Hoàn thành!\n');
}

// Export các hàm
module.exports = {
    connectMQTT,
    getStationsData,
    disconnect,
    getConnectionStatus,
    printTVAData,
    printMQTTData,
    printAllData
};

// Nếu chạy trực tiếp file này
if (require.main === module) {
    (async () => {
        try {
            await connectMQTT();
            console.log('\n✅ MQTT client đang chạy. Đợi nhận dữ liệu...');
            console.log('Press Ctrl+C để dừng.\n');
            
            // Hiển thị status mỗi 30s
            setInterval(() => {
                const status = getConnectionStatus();
                console.log('\n📊 Status:', status);
            }, 30000);
            
        } catch (error) {
            console.error('❌ Lỗi:', error.message);
            process.exit(1);
        }
    })();

    // Xử lý khi thoát
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Đang dừng...');
        disconnect();
        process.exit(0);
    });
}
