# Chuyển đổi sang PostgreSQL - Hoàn tất ✅

## Tóm tắt thay đổi

Hệ thống đã được chuyển đổi từ SQLite sang PostgreSQL (Supabase).

### Các thay đổi chính:

1. **Database Connection**
   - Từ: SQLite (local file `water_monitoring.db`)
   - Sang: PostgreSQL (Supabase Cloud)
   - URL: `postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`

2. **Package Dependencies**
   - Xóa: `sqlite3`
   - Thêm: `pg` (node-postgres)

3. **File Changes**
   - `database.js` - Viết lại hoàn toàn với PostgreSQL
   - `database-wrapper.js` - Đơn giản hóa thành wrapper
   - `package.json` - Cập nhật dependencies

4. **Backup Files** (an toàn)
   - `database.js.backup` - Backup SQLite version cũ
   - `database-wrapper.js.backup` - Backup wrapper cũ

## Syntax Changes (SQLite → PostgreSQL)

| SQLite | PostgreSQL |
|--------|-----------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `?` placeholders | `$1, $2, $3` placeholders |
| `LIKE` (case-sensitive) | `ILIKE` (case-insensitive) |
| `datetime('now')` | `NOW()` hoặc `CURRENT_TIMESTAMP` |
| `CURRENT_TIMESTAMP` | `CURRENT_TIMESTAMP` (giống) |
| `datetime('now', '-2 hours')` | `NOW() - INTERVAL '2 hours'` |

## Test Connection

Đã test thành công:
```
✅ Connection successful
✅ Database tables initialized  
📊 Current stations: 36
```

## Sử dụng

### Chạy server như bình thường:
```bash
npm start
```

### Test connection:
```bash
node test-postgres-connection.js
```

### Environment Variable (Optional)

Bạn có thể set DATABASE_URL trong environment:

**Windows PowerShell:**
```powershell
$env:DATABASE_URL="postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
```

**Linux/Mac:**
```bash
export DATABASE_URL="postgresql://postgres.llehbswibzhtsqgdulux:CR0kEeWlb8vemvuz@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
```

**Render.com:**
Thêm environment variable trong Settings → Environment

## Lưu ý quan trọng

1. **SSL Connection**: Database yêu cầu SSL, đã config sẵn với `rejectUnauthorized: false`

2. **Connection Pooling**: Sử dụng `pg.Pool` để quản lý connections hiệu quả

3. **Async/Await**: Tất cả database queries giờ là async functions

4. **Transaction Support**: PostgreSQL hỗ trợ transactions tốt hơn SQLite

5. **Data Migration**: Nếu cần migrate dữ liệu cũ từ SQLite, cần script riêng

## Các hàm database (giữ nguyên API)

Tất cả các hàm trong `database.js` giữ nguyên tên và cách sử dụng:

- `initDatabase()` - Khởi tạo tables
- `saveTVAData(stations)` - Lưu TVA data
- `saveMQTTData(stations)` - Lưu MQTT data  
- `saveSCADAData(stationsGrouped)` - Lưu SCADA data
- `getStatsData(options)` - Lấy dữ liệu thống kê
- `getAvailableParameters()` - Lấy danh sách parameters
- `getStations()` - Lấy danh sách trạm
- `checkStationsValueChanges(timeoutMinutes)` - Kiểm tra trạm online
- `getLatestStationsData()` - Lấy dữ liệu mới nhất
- `cleanOldData(daysToKeep)` - Xóa dữ liệu cũ
- `closeDatabase()` - Đóng connection

## Nếu cần rollback về SQLite

```bash
# Restore backup
Copy-Item database.js.backup database.js
Copy-Item database-wrapper.js.backup database-wrapper.js

# Reinstall sqlite3
npm uninstall pg
npm install sqlite3
```

## Support

Nếu gặp lỗi:
1. Kiểm tra DATABASE_URL đúng
2. Kiểm tra network/firewall cho phép kết nối Supabase
3. Xem logs trong terminal
4. Check Supabase dashboard

---

✅ **Migration hoàn tất thành công!**
