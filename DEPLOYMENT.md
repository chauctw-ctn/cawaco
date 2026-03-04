# 🚀 Hướng Dẫn Deploy Lên Render

Tài liệu chi tiết từng bước để deploy hệ thống lên Render.com

## 📋 Checklist Trước Khi Deploy

- [ ] Code đã được test local và hoạt động tốt
- [ ] Đã có tài khoản GitHub
- [ ] Đã có tài khoản Render.com
- [ ] Đã có PostgreSQL database (Supabase hoặc Render PostgreSQL)
- [ ] Đã chuẩn bị các credentials (TVA, SCADA usernames/passwords)

---

## 1️⃣ Chuẩn Bị Database (Supabase)

### Tạo Project Trên Supabase

1. Truy cập [supabase.com](https://supabase.com)
2. Đăng nhập và tạo "New Project"
3. Chọn region gần Việt Nam nhất (Singapore)
4. Đặt tên project: `camau-water-monitoring`
5. Tạo database password mạnh (lưu lại)

### Lấy Connection String

1. Vào Project → Settings → Database
2. Copy "Connection string" (chế độ "Session")
3. Format: 
   ```
   postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
4. Thay `[password]` bằng password database của bạn
5. Lưu connection string này (sẽ dùng ở bước 3)

### Cấu Hình Database

Không cần tạo tables thủ công - hệ thống sẽ tự động tạo khi start lần đầu.

---

## 2️⃣ Push Code Lên GitHub

### Khởi Tạo Git Repository (nếu chưa có)

```bash
cd cawaco
git init
git add .
git commit -m "Initial commit - Camau Water Monitoring System"
```

### Tạo Repository Trên GitHub

1. Truy cập [github.com](https://github.com)
2. Click "New Repository"
3. Tên: `camau-water-monitoring` (hoặc tên bạn chọn)
4. Chọn "Private" hoặc "Public"
5. **KHÔNG** chọn "Initialize with README"
6. Click "Create Repository"

### Push Code

```bash
git remote add origin https://github.com/your-username/camau-water-monitoring.git
git branch -M main
git push -u origin main
```

---

## 3️⃣ Deploy Trên Render

### Tạo Web Service

1. Đăng nhập [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Chọn "Connect a repository"
4. Authorize Render truy cập GitHub của bạn
5. Chọn repository `camau-water-monitoring`
6. Click "Connect"

### Cấu Hình Service

Render sẽ tự động phát hiện `render.yaml` và điền các thông tin:

- **Name**: `camau-water-monitoring`
- **Environment**: `Node`
- **Region**: Singapore (gần Việt Nam nhất)
- **Branch**: `main`
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### Thêm Environment Variables

Click "Environment" tab, thêm các biến sau:

#### Bắt Buộc

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
JWT_SECRET=your-very-strong-random-secret-key-here-change-me-123456789
```

**Tạo JWT_SECRET mạnh:**
```bash
# Option 1: Dùng OpenSSL (Linux/Mac)
openssl rand -base64 32

# Option 2: Dùng Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Option 3: Online generator
# https://generate-secret.now.sh/32
```

#### Tùy Chọn (nếu dùng credentials khác với mặc định)

```env
TVA_USERNAME=your-tva-username
TVA_PASSWORD=your-tva-password
SCADA_USERNAME=your-scada-username
SCADA_PASSWORD=your-scada-password
```

#### Telegram (nếu dùng cảnh báo)

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

**Lưu ý:** 
- PORT không cần set (Render tự động)
- NODE_ENV đã set trong render.yaml

### Deploy

1. Click "Create Web Service"
2. Render sẽ bắt đầu build và deploy
3. Theo dõi logs trong realtime
4. Đợi cho đến khi thấy "Live" (màu xanh)

---

## 4️⃣ Kiểm Tra Deploy Thành Công

### Kiểm Tra Logs

Trong Render Dashboard → Logs, bạn sẽ thấy:

```
✅ Database đã sẵn sàng
✅ MQTT client đã kết nối
✅ Đã lấy dữ liệu TVA: XX trạm
✅ Đã lưu XX bản ghi MQTT vào database
✅ Đã lấy dữ liệu SCADA: XX trạm
```

### Test Health Check

```bash
curl https://your-app-name.onrender.com/api/stations
```

Kết quả mong đợi:
```json
{
  "success": true,
  "totalStations": 50,
  "onlineStations": 45,
  "offlineStations": 5,
  "stations": [...]
}
```

### Truy Cập Web

1. Mở browser
2. Vào URL: `https://your-app-name.onrender.com`
3. Đăng nhập:
   - Username: `admin`
   - Password: `admin123`
4. Kiểm tra:
   - Bản đồ hiển thị các trạm
   - Thống kê dữ liệu
   - Chất lượng nước
   - Dữ liệu giấy phép

---

## 5️⃣ Cấu Hình Sau Deploy

### Đổi Mật Khẩu Admin

1. Đăng nhập với admin/admin123
2. Click icon user → "Đổi mật khẩu"
3. Đặt mật khẩu mạnh mới

### Cấu Hình Telegram (Tùy Chọn)

1. Tạo Telegram Bot:
   - Chat với @BotFather
   - `/newbot` → đặt tên bot
   - Lưu Bot Token

2. Lấy Chat ID:
   - Gửi tin nhắn cho bot
   - Truy cập: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Tìm `"chat":{"id":123456789}`

3. Cấu hình trong app:
   - Đăng nhập admin
   - Click icon user → "Cấu hình Telegram"
   - Nhập Chat ID
   - Bật "Bật cảnh báo Telegram"
   - Test gửi tin nhắn
   - Lưu cấu hình

---

## 6️⃣ Monitoring & Maintenance

### Xem Logs Realtime

```bash
# Trong Render Dashboard
Logs → Enable "Real-time logs"
```

### Restart Service

```bash
# Trong Render Dashboard
Manual Deploy → "Clear build cache & deploy"
```

### Update Code

```bash
# Push code mới lên GitHub
git add .
git commit -m "Update features"
git push

# Render sẽ tự động deploy
```

### Database Monitoring

1. Vào Supabase Dashboard
2. Table Editor → Xem dữ liệu
3. Database → Settings → Usage (theo dõi dung lượng)

---

## ⚠️ Troubleshooting

### Lỗi: Database Connection Failed

**Nguyên nhân:**
- Connection string sai
- Database không accessible
- SSL certificate issue

**Giải pháp:**
1. Kiểm tra DATABASE_URL trong Environment Variables
2. Test connection từ local:
   ```bash
   psql "postgresql://..."
   ```
3. Đảm bảo Supabase cho phép kết nối từ anywhere (default)

### Lỗi: Build Failed

**Nguyên nhân:**
- Dependencies missing
- Node version không khớp

**Giải pháp:**
1. Kiểm tra `package.json` có đầy đủ dependencies
2. Xác nhận `engines.node: "20.x"` trong package.json
3. Clear cache và rebuild:
   ```bash
   # Render Dashboard
   Manual Deploy → Clear build cache & deploy
   ```

### Lỗi: Health Check Failed

**Nguyên nhân:**
- Server không start
- Database chưa init xong
- MQTT connection timeout

**Giải pháp:**
1. Xem logs chi tiết
2. Tăng timeout trong Health Check settings
3. Kiểm tra `/api/stations` endpoint response

### App Chạy Chậm (Cold Start)

**Nguyên nhân:**
- Free tier của Render sleep sau 15 phút không dùng

**Giải pháp:**
1. Upgrade lên Starter plan ($7/month)
2. Hoặc dùng cron job ping app mỗi 10 phút:
   ```bash
   # Setup trên cron-job.org
   URL: https://your-app.onrender.com/api/stations
   Interval: Every 10 minutes
   ```

### MQTT Không Kết Nối

**Nguyên nhân:**
- Network/Firewall block
- MQTT broker down

**Giải pháp:**
1. App vẫn chạy bình thường nhưng không có realtime MQTT
2. Vẫn có data từ TVA và SCADA
3. Kiểm tra MQTT broker status
4. Contact MQTT admin

---

## 📊 Performance Tips

### Tối Ưu Database

```sql
-- Tạo indexes để query nhanh hơn (optional)
CREATE INDEX idx_tva_data_timestamp ON tva_data(created_at);
CREATE INDEX idx_mqtt_data_timestamp ON mqtt_data(created_at);
CREATE INDEX idx_scada_data_timestamp ON scada_data(created_at);
```

### Monitoring

- Theo dõi CPU/Memory usage trong Render Dashboard
- Kiểm tra database size trong Supabase
- Setup alerts khi service down

---

## 🔄 Update Checklist

Khi có code mới:

1. [ ] Test local kỹ trước
2. [ ] Commit với message rõ ràng
3. [ ] Push lên GitHub
4. [ ] Theo dõi Render auto-deploy
5. [ ] Kiểm tra logs không có lỗi
6. [ ] Test trên production URL
7. [ ] Verify tất cả features hoạt động

---

## 📞 Support

Nếu gặp vấn đề:

1. Kiểm tra logs trên Render Dashboard
2. Xem Supabase logs
3. Review lại các bước trong tài liệu này
4. Liên hệ team support

---

## ✅ Deployment Checklist

- [ ] Database setup trên Supabase
- [ ] Code pushed lên GitHub
- [ ] Web service created trên Render
- [ ] Environment variables đã cấu hình đủ
- [ ] Health check PASSED
- [ ] Website accessible
- [ ] Đăng nhập thành công
- [ ] Bản đồ hiển thị trạm
- [ ] Data được cập nhật
- [ ] Đã đổi password admin
- [ ] Telegram config (nếu dùng)

🎉 **HOÀN TẤT!** Hệ thống đã sẵn sàng phục vụ.
