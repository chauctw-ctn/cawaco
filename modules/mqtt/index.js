/**
 * MQTT Data Collection Module
 * Module thu thập dữ liệu từ MQTT Broker
 */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

const DATA_MQTT_PATH = path.join(__dirname, '../../data_mqtt.json');
const { MQTT_STATION_COORDINATES } = require('../../mqtt-coordinates');

// Cache dữ liệu
let cachedData = {
    timestamp: new Date().toISOString(),
    totalStations: 0,
    stations: [],
    deviceGroups: {}
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
 * Xử lý dữ liệu MQTT message
 */
function processMessage(message) {
    try {
        if (!message || typeof message !== 'string') {
            return;
        }
        
        const trimmed = message.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return;
        }
        
        // Sửa lỗi JSON malformed: thay thế các giá trị số không hợp lệ
        let cleanedMessage = trimmed
            .replace(/:\s*-?nan\b/gi, ':0')          // "value": nan hoặc -nan -> "value": 0
            .replace(/:\s*-?inf\b/gi, ':0')          // "value": inf hoặc -inf -> "value": 0
            .replace(/:\s*-\s*([,}\]])/g, ':0$1')    // "value": - -> "value": 0
            .replace(/:\s*-\s*$/g, ':0')             // "value": - ở cuối
            .replace(/:\s*\.\s*([,}\]])/g, ':0$1')   // "value": . -> "value": 0
            .replace(/:\s*-\.\s*([,}\]])/g, ':0$1'); // "value": -. -> "value": 0
        
        const payload = JSON.parse(cleanedMessage);
        
        if (!payload.d || !Array.isArray(payload.d)) {
            return;
        }
        
        console.log('📨 Nhận dữ liệu MQTT:', payload.d.length, 'thông số');
        
        const timestamp = payload.ts || new Date().toISOString();
        
        payload.d.forEach(item => {
            const tag = item.tag;
            let value = item.value;
            
            if (!tag || value === undefined || value === null) return;
            
            // Validate và clean value nếu là số
            if (typeof value === 'string') {
                // Nếu value là string rỗng hoặc chỉ chứa dấu trừ/chấm -> set về 0
                if (value.trim() === '' || value.trim() === '-' || value.trim() === '.') {
                    value = 0;
                } else {
                    // Thử parse thành number nếu có thể
                    const parsed = parseFloat(value);
                    if (!isNaN(parsed) && isFinite(parsed)) {
                        value = parsed;
                    }
                }
            }
            
            // Kiểm tra nếu value vẫn không hợp lệ
            if (typeof value === 'number' && (!isFinite(value) || isNaN(value))) {
                value = 0;
            }
            
            // Parse tag: G30A_MUCNUOC -> deviceCode: G30A, parameterType: MUCNUOC
            const parts = tag.split('_');
            let deviceCode = parts[0];
            let parameterType = parts.slice(1).join('_');
            
            // Xử lý trường hợp đặc biệt (GS1_NM2, GS2_NM1, etc.)
            if (parts.length > 2 && (parts[0] === 'GS1' || parts[0] === 'GS2' || parts[0] === 'QT1' || parts[0] === 'QT2')) {
                deviceCode = parts[0] + '_' + parts[1];
                parameterType = parts.slice(2).join('_');
            }
            
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
                name: config.mqtt.parameterNameMap[parameterType] || parameterType,
                time: new Date(timestamp).toLocaleString('vi-VN', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }),
                value: value,
                unit: getUnit(parameterType),
                rawType: parameterType,
                timestamp: timestamp
            };
            
            cachedData.deviceGroups[deviceCode].lastUpdate = timestamp;
        });
        
        updateStationsFormat();

    } catch (error) {
        console.error('❌ Lỗi khi xử lý message:', error.message);
        
        // Log message gốc để debug (giới hạn độ dài)
        if (typeof message === 'string' && message.length < 500) {
            console.error('📋 Message gây lỗi:', message);
        } else if (typeof message === 'string') {
            console.error('📋 Message gây lỗi (300 ký tự đầu):', message.substring(0, 300) + '...');
        }
    }
}

/**
 * Chuyển đổi deviceGroups sang format stations
 */
function updateStationsFormat() {
    const stations = [];
    
    if (!cachedData.deviceGroups) return;
    
    for (const deviceCode in cachedData.deviceGroups) {
        if (!config.mqtt.deviceNameMap[deviceCode]) {
            console.warn(`⚠️ Bỏ qua device không có trong cấu hình: ${deviceCode}`);
            continue;
        }
        
        const device = cachedData.deviceGroups[deviceCode];
        const stationName = config.mqtt.deviceNameMap[deviceCode];
        
        const parameters = Object.values(device.parameters);
        
        if (parameters.length > 0) {
            const coords = MQTT_STATION_COORDINATES[deviceCode];
            
            if (!coords) {
                console.warn(`⚠️ Thiếu tọa độ cho trạm ${deviceCode} (${stationName})`);
            }
            
            stations.push({
                station: stationName,
                deviceName: deviceCode,
                updateTime: device.lastUpdate || new Date().toISOString(),
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

    cachedData.timestamp = new Date().toISOString();
    cachedData.totalStations = stations.length;
    cachedData.stations = stations;

    try {
        fs.writeFileSync(DATA_MQTT_PATH, JSON.stringify(cachedData, null, 2), 'utf8');
        console.log(`✅ Đã cập nhật ${cachedData.totalStations} trạm MQTT`);
    } catch (error) {
        console.error('⚠️ Lỗi lưu file:', error.message);
    }
}

/**
 * Kết nối đến MQTT broker
 */
function connectMQTT() {
    return new Promise((resolve, reject) => {
        console.log(`🔌 Đang kết nối đến MQTT broker: ${config.mqtt.broker}:${config.mqtt.port}`);
        
        mqttClient = mqtt.connect(config.mqtt.broker, {
            port: config.mqtt.port,
            clean: true,
            connectTimeout: config.mqtt.connectTimeout,
            clientId: config.mqtt.clientId,
            reconnectPeriod: config.mqtt.reconnectPeriod
        });

        mqttClient.on('connect', () => {
            console.log('✅ Đã kết nối MQTT broker');
            isConnected = true;
            
            mqttClient.subscribe(config.mqtt.topic, (err) => {
                if (err) {
                    console.error('❌ Lỗi subscribe topic:', err);
                    reject(err);
                } else {
                    console.log(`📡 Đã subscribe vào topic: ${config.mqtt.topic}`);
                    resolve();
                }
            });
        });

        mqttClient.on('message', (topic, message) => {
            const messageStr = message.toString();
            
            if (!messageStr || messageStr === topic || messageStr.startsWith('telemetry')) {
                return;
            }
            
            if (!messageStr.startsWith('{') && !messageStr.startsWith('[')) {
                return;
            }
            
            console.log(`\n📩 Nhận message từ topic: ${topic}`);
            processMessage(messageStr);
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

        setTimeout(() => {
            if (!isConnected) {
                reject(new Error('Timeout kết nối MQTT'));
            }
        }, config.mqtt.connectTimeout);
    });
}

/**
 * Lấy dữ liệu từ cache
 */
function getStationsData() {
    if (fs.existsSync(DATA_MQTT_PATH)) {
        try {
            const fileData = JSON.parse(fs.readFileSync(DATA_MQTT_PATH, 'utf8'));
            
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
        isConnected = false;
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

module.exports = {
    connectMQTT,
    getStationsData,
    disconnect,
    getConnectionStatus
};
