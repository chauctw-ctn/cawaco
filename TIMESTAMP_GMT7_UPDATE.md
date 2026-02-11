# Cập nhật Timestamp GMT+7 - Hoàn tất ✅

## Thay đổi chính

Đã đồng bộ timestamp theo giờ GMT+7 (Hồ Chí Minh) và lưu timestamp tại thời điểm hiện tại, **không sử dụng timestamp từ API/MQTT**.

## Chi tiết kỹ thuật

### 1. **Sử dụng CURRENT_TIMESTAMP của PostgreSQL**
Thay vì sử dụng JavaScript `new Date()`, giờ sử dụng `CURRENT_TIMESTAMP` của PostgreSQL để lấy thời gian hiện tại trực tiếp từ database.

**Trước:**
```javascript
const timestamp = new Date().toISOString();
await client.query(
    `INSERT INTO tva_data (..., timestamp, update_time)
     VALUES (..., $6, $7)`,
    [..., timestamp, station.updateTime || timestamp]  // ❌ Dùng timestamp từ API
);
```

**Sau:**
```javascript
await client.query(
    `INSERT INTO tva_data (..., timestamp, update_time)
     VALUES (..., CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,  // ✅ Dùng thời gian hiện tại
    [...] // Không còn truyền timestamp
);
```

### 2. **Set Timezone GMT+7 cho mỗi connection**
Trước mỗi lần lưu dữ liệu, set timezone của PostgreSQL session về `Asia/Ho_Chi_Minh` (GMT+7).

```javascript
const client = await pool.connect();

try {
    // Set timezone cho connection này - Múi giờ Việt Nam (GMT+7)
    await client.query("SET TIMEZONE='Asia/Ho_Chi_Minh'");
    
    // Lưu dữ liệu với CURRENT_TIMESTAMP
    // ...
}
```

### 3. **Pool config với timezone**
Thêm timezone option vào Pool configuration:

```javascript
pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    options: '-c TimeZone=Asia/Ho_Chi_Minh'  // Set timezone mặc định
});
```

## Kết quả

### Test Results:
```
⏰ Time BEFORE save:   13:39:18 UTC (= 20:39:18 GMT+7)
📊 Saved timestamp:    13:39:20 UTC (= 20:39:20 GMT+7)
📊 update_time:        20:39:20+07 (hiển thị GMT+7)
⏱️  Time difference:    2.29 seconds

✅ SUCCESS! Timestamp được lưu đúng theo thời gian hiện tại
✅ Không sử dụng timestamp cũ từ API
```

### So sánh với yêu cầu:
- ✅ Đồng bộ timestamp theo giờ GMT+7
- ✅ Lấy timestamp tại thời điểm hiện tại khi lưu
- ✅ Không quan tâm timestamp từ API hoặc MQTT
- ✅ Timestamp chính xác tới mili-giây

## Các hàm được cập nhật

1. **saveTVAData()** - Lưu dữ liệu TVA
2. **saveMQTTData()** - Lưu dữ liệu MQTT  
3. **saveSCADAData()** - Lưu dữ liệu SCADA

Tất cả 3 hàm giờ đều:
- Set timezone = Asia/Ho_Chi_Minh trước khi lưu
- Sử dụng CURRENT_TIMESTAMP thay vì timestamp từ nguồn dữ liệu
- Lưu thời gian chính xác tại thời điểm INSERT vào database

## Cách hoạt động

```
┌─────────────────────────────────────────────────────┐
│  API/MQTT trả về dữ liệu với timestamp CŨ           │
│  { data: [...], updateTime: "2025-01-01T00:00:00Z" }│
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  Node.js nhận dữ liệu (bỏ qua timestamp cũ)        │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  Set PostgreSQL timezone = Asia/Ho_Chi_Minh         │
│  await client.query("SET TIMEZONE='...'");          │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  INSERT với CURRENT_TIMESTAMP                       │
│  INSERT INTO tva_data (..., timestamp)              │
│  VALUES (..., CURRENT_TIMESTAMP)                    │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│  Database lưu timestamp MỚI (thời điểm hiện tại)   │
│  timestamp: 2026-02-11 20:39:20+07                  │
└─────────────────────────────────────────────────────┘
```

## Testing

### Test connection với timezone:
```bash
node test-postgres-connection.js
```

### Test timestamp save:
```bash
node test-timestamp-save.js
```

### Debug timezone:
```bash
node debug-timezone.js
```

## Lưu ý quan trọng

1. **TIMESTAMPTZ trong PostgreSQL**
   - Luôn lưu timestamp dưới dạng UTC internally
   - Hiển thị theo timezone của session khi query
   - With timezone support (+07, +00, etc.)

2. **Performance**
   - `SET TIMEZONE` chỉ áp dụng cho session hiện tại
   - Mỗi connection từ pool sẽ cần set lại
   - Không ảnh hưởng nhiều đến performance

3. **Compatibility**
   - Tương thích với tất cả queries hiện tại
   - Không cần thay đổi frontend code
   - Timestamp vẫn được trả về dưới dạng ISO 8601

## Nếu cần rollback

Revert các thay đổi trong [database.js](database.js):
- Xóa `await client.query("SET TIMEZONE=...");`
- Thay CURRENT_TIMESTAMP bằng $6, $7 placeholders
- Thêm lại timestamp parameters vào query

---

✅ **Cập nhật hoàn tất! Timestamp giờ đã đồng bộ GMT+7 và lưu đúng thời gian hiện tại.**
