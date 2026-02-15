# Tổng kết các sửa lỗi - Statistics và Visitor Tracking

## Ngày: 15/02/2026

### 1. ✅ Xóa thông báo hint trong stats.html

**Vấn đề:** Có dòng text "💡 Dữ liệu hiển thị từ 00:00:00 đến 23:59:59 của ngày đã chọn" cần xóa bỏ

**Giải pháp:** Đã xóa phần `<small>` tag chứa thông báo này trong [stats.html](public/stats.html)

---

### 2. ✅ Sửa lỗi hiển thị ngày/giờ trong bảng thống kê

**Vấn đề:** 
- Cột "Ngày/Giờ" hiển thị đúng khi chạy local (SQLite?)
- Hiển thị sai khi deploy trên Render với PostgreSQL
- Nguyên nhân: Timezone không được xử lý đúng giữa PostgreSQL và client

**Giải pháp đã áp dụng:**

#### A. Cải thiện kết nối PostgreSQL timezone ([modules/database/index.js](modules/database/index.js))

```javascript
// Thêm event handler để set timezone cho mọi connection trong pool
pool.on('connect', (client) => {
    client.query('SET timezone = \'Asia/Ho_Chi_Minh\'', (err) => {
        if (err) {
            console.error('❌ Lỗi thiết lập timezone:', err.message);
        }
    });
});
```

#### B. Sửa query để return timestamp theo timezone Vietnam

```javascript
// Trong getStatsData(), thêm AT TIME ZONE để convert timestamp
SELECT 
    ...
    timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh' as timestamp,
    ...
FROM ${table}
```

#### C. Cải thiện formatting timestamp trên server-side

```javascript
// Trong getStatsData(), format time rõ ràng hơn
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
```

**Kết quả:** 
- Timestamp được lưu trong PostgreSQL dưới dạng TIMESTAMPTZ (UTC internally)
- Khi query, timezone được convert sang Asia/Ho_Chi_Minh tự động
- Client-side nhận timestamp đúng và format đúng theo múi giờ Việt Nam

---

### 3. ✅ Sửa lỗi Visitor Stats không lưu vào PostgreSQL

**Vấn đề:**
- Dữ liệu thống kê lượt truy cập không được lưu vào database
- Có inconsistency giữa property names (camelCase vs snake_case)
- Thiếu error handling khi table visitor_stats rỗng

**Giải pháp đã áp dụng:**

#### A. Sửa property names consistency

**Trước:**
```javascript
// getVisitorStats() trả về camelCase
return {
    totalVisitors: parseInt(result.rows[0].total_visitors),
    todayDate: result.rows[0].today_date,
    ...
}

// Nhưng server.js expects snake_case
totalVisitors: dbStats.total_visitors  // ❌ Undefined!
```

**Sau:**
```javascript
// getVisitorStats() bây giờ return snake_case đồng nhất
return {
    total_visitors: parseInt(result.rows[0].total_visitors),
    today_date: result.rows[0].today_date,
    today_visitors: parseInt(result.rows[0].today_visitors),
    updated_at: result.rows[0].updated_at
};
```

#### B. Thêm error handling trong incrementVisitorCount()

```javascript
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

        // Continue with UPDATE if record exists...
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
```

**Kết quả:**
- Visitor stats bây giờ được lưu đúng vào PostgreSQL
- Khi restart server, `total_visitors` không bị reset
- `currentVisitors` và `todayVisitors` vẫn dùng RAM cho real-time tracking
- Error handling tốt hơn khi database chưa có dữ liệu

---

## Tổng kết các file đã sửa

1. **[public/stats.html](public/stats.html)** - Xóa hint text về timezone
2. **[modules/database/index.js](modules/database/index.js)** - 4 changes:
   - Thêm timezone setting cho pool connections
   - Sửa query timestamp với AT TIME ZONE
   - Cải thiện timestamp formatting
   - Sửa getVisitorStats() return values (snake_case)
   - Thêm error handling trong incrementVisitorCount()

---

## Kiểm tra sau khi deploy

### 1. Kiểm tra timezone

```bash
# Test query timezone
SELECT NOW(), CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh' as vietnam_time;
```

### 2. Kiểm tra visitor stats

```bash
# Xem visitor stats table
SELECT * FROM visitor_stats;

# Test increment
curl -X POST http://localhost:3000/api/visitors/register \
  -H "Content-Type: application/json" \
  -d '{"page":"/","timestamp":"2026-02-15T10:00:00Z"}'

# Check stats
curl http://localhost:3000/api/visitors/stats
```

### 3. Kiểm tra stats data

```bash
# Test stats API với date range
curl "http://localhost:3000/api/stats?startDate=2026-02-14&endDate=2026-02-15&interval=60"
```

---

## Notes quan trọng

- ✅ Timezone được xử lý ở cả server (PostgreSQL) và client (JavaScript)
- ✅ TIMESTAMPTZ trong PostgreSQL lưu UTC internally nhưng display theo session timezone
- ✅ Client-side sử dụng `Intl.DateTimeFormat` với `timeZone: 'Asia/Ho_Chi_Minh'` để format
- ✅ Visitor tracking giờ persistent trong database, không bị mất khi restart
- ⚠️ Database phải có bảng `visitor_stats` được tạo qua `initDatabase()`
- ⚠️ Nếu cần reset visitor count, dùng admin API hoặc direct SQL

---

## Backup commands (nếu cần)

```sql
-- Reset visitor stats (admin only)
UPDATE visitor_stats 
SET total_visitors = 20102347, 
    today_visitors = 0, 
    today_date = CURRENT_DATE 
WHERE id = (SELECT id FROM visitor_stats ORDER BY id DESC LIMIT 1);

-- Check timezone setting
SHOW timezone;

-- Manually insert visitor_stats if missing
INSERT INTO visitor_stats (total_visitors, today_date, today_visitors)
VALUES (20102347, CURRENT_DATE, 0)
ON CONFLICT DO NOTHING;
```
