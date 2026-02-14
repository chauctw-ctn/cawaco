# CẤU TRÚC DỰ ÁN MỚI - MODULAR ARCHITECTURE

## 📁 Cấu Trúc Thư Mục

```
webJS-new/
├── config/
│   └── index.js                    # Cấu hình tập trung cho toàn bộ hệ thống
├── modules/
│   ├── database/
│   │   └── index.js               # Module quản lý PostgreSQL
│   ├── mqtt/
│   │   └── index.js               # Module thu thập dữ liệu MQTT
│   ├── tva/
│   │   └── index.js               # Module thu thập dữ liệu TVA
│   └── scada/
│       └── index.js               # Module thu thập dữ liệu SCADA
├── public/                        # Static files (HTML, CSS, JS)
├── server.js                      # Main server (Đã được cập nhật)
└── README_MODULE_STRUCTURE.md     # Tài liệu này
```

## 🎯 Các Module Chính

### 1. **Config Module** (`config/index.js`)

Module cấu hình tập trung cho toàn bộ hệ thống.

**Chứa:**
- Cấu hình Server (port, env)
- Cấu hình Database PostgreSQL (connection string, limits)
- Cấu hình MQTT Broker (url, port, topic, device mapping)
- Cấu hình TVA (url, credentials, timeouts)
- Cấu hình SCADA (url, credentials, timeouts)
- Cấu hình Intervals (tần suất cập nhật dữ liệu)
- Cấu hình Authentication (users, roles)

**Sử dụng:**
```javascript
const config = require('./config');

console.log(config.server.port);        // 3000
console.log(config.database.url);       // PostgreSQL URL
console.log(config.mqtt.broker);        // MQTT broker URL
console.log(config.tva.username);       // TVA credentials
```

---

### 2. **Database Module** (`modules/database/index.js`)

Module quản lý tất cả operations với PostgreSQL database.

**Chức năng:**
- Khởi tạo connection pool
- Tạo tables và indexes
- Lưu dữ liệu TVA, MQTT, SCADA
- Lấy dữ liệu thống kê
- Quản lý visitor tracking
- Cleanup dữ liệu cũ

**API:**
```javascript
const dbModule = require('./modules/database');

// Khởi tạo database
await dbModule.initDatabase();

// Lưu dữ liệu
await dbModule.saveTVAData(tvaStations);
await dbModule.saveMQTTData(mqttStations);
await dbModule.saveSCADAData(scadaStations);

// Lấy dữ liệu
const stats = await dbModule.getStatsData(options);
const stations = await dbModule.getStations();
const latest = await dbModule.getLatestStationsData();

// Visitor tracking
await dbModule.incrementVisitorCount();
const visitorStats = await dbModule.getVisitorStats();

// Cleanup
await dbModule.cleanOldData(90); // Giữ 90 ngày
```

---

### 3. **MQTT Module** (`modules/mqtt/index.js`)

Module thu thập dữ liệu realtime từ MQTT Broker.

**Chức năng:**
- Kết nối đến MQTT broker
- Subscribe vào topic telemetry
- Xử lý và parse MQTT messages
- Cache dữ liệu realtime
- Group dữ liệu theo station

**API:**
```javascript
const mqttModule = require('./modules/mqtt');

// Kết nối
await mqttModule.connectMQTT();

// Lấy dữ liệu cache
const data = mqttModule.getStationsData();
console.log(data.totalStations);
console.log(data.stations);

// Kiểm tra status
const status = mqttModule.getConnectionStatus();
console.log(status.connected);

// Ngắt kết nối
mqttModule.disconnect();
```

---

### 4. **TVA Module** (`modules/tva/index.js`)

Module thu thập dữ liệu từ hệ thống TVA (Quan Trắc).

**Chức năng:**
- Login vào hệ thống TVA
- Crawl dữ liệu từ dashboard
- Parse HTML và extract data
- Retry logic tự động
- Cache dữ liệu vào file JSON

**API:**
```javascript
const tvaModule = require('./modules/tva');

// Crawl dữ liệu (1 lần)
const stations = await tvaModule.crawlTVAData();

// Crawl với retry logic (khuyến nghị)
const stations = await tvaModule.getTVADataWithRetry();
// Mặc định retry 3 lần với delay 5s

console.log(stations.length);
console.log(stations[0].station);
console.log(stations[0].data);
```

---

### 5. **SCADA Module** (`modules/scada/index.js`)

Module thu thập dữ liệu từ hệ thống SCADA-TVA.

**Chức năng:**
- Login vào Rapid SCADA
- Warm up view cache
- Lấy dữ liệu realtime từ API JSON
- Channel-based data fetching
- Group dữ liệu theo station
- Retry logic

**API:**
```javascript
const scadaModule = require('./modules/scada');

// Crawl dữ liệu (1 lần)
const channels = await scadaModule.crawlScadaTVA();

// Crawl với retry logic
const channels = await scadaModule.getSCADADataWithRetry();

// Lấy dữ liệu đã group
const grouped = scadaModule.getGroupedStations();

console.log(channels.length);
console.log(grouped);
```

---

## 🚀 Cách Sử Dụng

### Server.js đã được cập nhật

File `server.js` đã được refactor để sử dụng các module mới:

```javascript
// Import modules
const config = require('./config');
const mqttModule = require('./modules/mqtt');
const tvaModule = require('./modules/tva');
const scadaModule = require('./modules/scada');
const dbModule = require('./modules/database');

// Khởi động server
app.listen(config.server.port, async () => {
    // Khởi tạo database
    await dbModule.initDatabase();
    
    // Kết nối MQTT
    await mqttModule.connectMQTT();
    
    // Cập nhật TVA
    await tvaModule.getTVADataWithRetry();
    
    // Lưu MQTT data
    const mqttData = mqttModule.getStationsData();
    await dbModule.saveMQTTData(mqttData.stations);
    
    // Setup intervals từ config
    setInterval(updateTVAData, config.intervals.tva);
    setInterval(saveMQTTDataToDB, config.intervals.mqtt);
    setInterval(updateSCADAData, config.intervals.scada);
});
```

---

## ⚙️ Cấu Hình

### Thay đổi cấu hình

Tất cả cấu hình được tập trung trong `config/index.js`:

```javascript
module.exports = {
    server: {
        port: process.env.PORT || 3000
    },
    database: {
        url: process.env.DATABASE_URL || 'postgresql://...'
    },
    mqtt: {
        broker: process.env.MQTT_BROKER || 'mqtt://14.225.252.85',
        port: parseInt(process.env.MQTT_PORT) || 1883
    },
    intervals: {
        tva: 5 * 60 * 1000,      // 5 phút
        mqtt: 1 * 60 * 1000,     // 1 phút
        scada: 5 * 60 * 1000,    // 5 phút
        cleanup: 24 * 60 * 60 * 1000 // 24 giờ
    }
};
```

### Environment Variables

Hỗ trợ environment variables:
- `PORT` - Server port
- `DATABASE_URL` - PostgreSQL connection string
- `MQTT_BROKER` - MQTT broker URL
- `MQTT_PORT` - MQTT port
- `TVA_USERNAME` - TVA username
- `TVA_PASSWORD` - TVA password
- `SCADA_USERNAME` - SCADA username
- `SCADA_PASSWORD` - SCADA password

---

## 📊 Luồng Dữ Liệu

```
┌─────────────┐
│ MQTT Broker │ ─────┐
└─────────────┘      │
                     │
┌─────────────┐      │     ┌──────────────┐     ┌────────────┐
│ TVA System  │ ──────┼────>│    Modules   │────>│ PostgreSQL │
└─────────────┘      │     └──────────────┘     └────────────┘
                     │            │
┌─────────────┐      │            │
│ SCADA System│ ─────┘            ▼
└─────────────┘          ┌─────────────────┐
                         │   Express API   │
                         └─────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  Web Dashboard  │
                         └─────────────────┘
```

### Quy trình:
1. **MQTT Module** liên tục nhận dữ liệu realtime
2. **TVA Module** crawl mỗi 5 phút
3. **SCADA Module** crawl mỗi 5 phút
4. **Database Module** lưu tất cả vào PostgreSQL
5. **Server** cung cấp API cho frontend
6. **Frontend** hiển thị bản đồ và dashboard

---

## 🛠️ Bảo Trì và Phát Triển

### Thêm nguồn dữ liệu mới

1. Tạo module mới trong `modules/`:
```javascript
// modules/newsource/index.js
async function getData() {
    // Implementation
}

module.exports = { getData };
```

2. Thêm config trong `config/index.js`:
```javascript
newsource: {
    url: '...',
    username: '...',
    password: '...'
}
```

3. Sử dụng trong `server.js`:
```javascript
const newsourceModule = require('./modules/newsource');
const data = await newsourceModule.getData();
await dbModule.saveNewsourceData(data);
```

### Thay đổi tần suất cập nhật

Chỉnh sửa trong `config/index.js`:
```javascript
intervals: {
    tva: 10 * 60 * 1000,     // 10 phút thay vì 5
    mqtt: 30 * 1000,         // 30 giây
    scada: 15 * 60 * 1000    // 15 phút
}
```

---

## ✅ Lợi Ích Của Cấu Trúc Mới

1. **Tách biệt rõ ràng**: Mỗi module có trách nhiệm riêng
2. **Dễ bảo trì**: Thay đổi ở một module không ảnh hưởng các module khác
3. **Dễ test**: Có thể test từng module độc lập
4. **Dễ mở rộng**: Thêm nguồn dữ liệu mới dễ dàng
5. **Cấu hình tập trung**: Không cần tìm kiếm config khắp nơi
6. **Reusable**: Các module có thể tái sử dụng trong dự án khác

---

## 📝 Migration từ Code Cũ

### Files cũ (giữ lại để tham khảo):
- `mqtt_client.js` → `modules/mqtt/index.js`
- `getKeyTVA.js` → `modules/tva/index.js`
- `scada-tva-crawler.js` → `modules/scada/index.js`
- `database.js` → `modules/database/index.js`

### Files coordinate (giữ nguyên):
- `tva-coordinates.js`
- `mqtt-coordinates.js`
- `scada-coordinates.js`
- `tva-channel-mapping.js`

---

## 🔧 Testing

### Test từng module riêng:

```javascript
// Test MQTT
const mqttModule = require('./modules/mqtt');
await mqttModule.connectMQTT();
console.log(mqttModule.getStationsData());

// Test TVA
const tvaModule = require('./modules/tva');
const data = await tvaModule.getTVADataWithRetry();
console.log(data);

// Test SCADA
const scadaModule = require('./modules/scada');
const channels = await scadaModule.getSCADADataWithRetry();
console.log(channels);

// Test Database
const dbModule = require('./modules/database');
await dbModule.initDatabase();
await dbModule.saveTVAData(data);
```

---

## 🚦 Khởi Động Server

```bash
# Development
npm start

# Production (với PM2)
pm2 start server.js --name "water-monitoring"
pm2 logs water-monitoring
pm2 restart water-monitoring
```

---

## 📞 Hỗ Trợ

Nếu có vấn đề, kiểm tra:
1. Logs trong console
2. File cache: `data_mqtt.json`, `data_quantrac.json`, `data_scada_tva.json`
3. Database connection
4. Network connectivity đến MQTT/TVA/SCADA

---

**Cập nhật:** 12/02/2026
**Version:** 2.0.0 - Modular Architecture
