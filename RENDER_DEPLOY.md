# Hướng dẫn Deploy lên Render.com

## 🚀 Các bước deploy

### 1. Tạo Web Service trên Render

1. Truy cập [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **Web Service**
3. Connect repository từ GitHub
4. Cấu hình:
   - **Name**: `cawaco-monitoring` (hoặc tên bạn muốn)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (hoặc plan phù hợp)

### 2. Cấu hình Environment Variables

Trong Render Dashboard, vào **Environment** và thêm các biến sau:

#### Bắt buộc:
```
NODE_ENV=production
PORT=3000
```

#### Database (PostgreSQL):
```
DATABASE_URL=postgresql://user:password@host:port/database
```
*Lấy từ Supabase hoặc PostgreSQL provider của bạn*

#### Telegram Alerts (Tùy chọn):
```
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id
```

#### Security:
```
JWT_SECRET=your_random_secret_key_here
```

### 3. ⚠️ Cấu hình Persistent Disk cho Telegram Config

**QUAN TRỌNG**: Để telegram config không bị mất khi restart, bạn cần mount persistent disk:

1. Trong Render Dashboard, vào tab **Disks**
2. Click **Add Disk**
3. Cấu hình:
   - **Name**: `data`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB (đủ cho config files)

4. Sau khi tạo disk, thêm environment variable:
```
DATA_DIR=/var/data
```

**Giải thích**: 
- File system mặc định của Render là **ephemeral** (tạm thời)
- Mọi file được tạo sẽ bị xóa khi container restart
- Persistent disk đảm bảo file `telegram-config.json` không bị mất

### 4. Deploy

1. Click **Create Web Service**
2. Render sẽ tự động build và deploy
3. Sau khi deploy xong, truy cập URL được cung cấp

---

## 📡 Kiểm tra Telegram Alerts

### 1. Health Check Endpoint

Truy cập endpoint này để kiểm tra trạng thái telegram alerts:
```
https://your-app.onrender.com/api/telegram/health
```

Response mẫu khi **healthy**:
```json
{
  "success": true,
  "status": "healthy",
  "enabled": true,
  "botTokenSet": true,
  "chatIdSet": true,
  "intervalActive": true,
  "initialized": true,
  "configFileExists": true,
  "dataDirSet": true,
  "warnings": []
}
```

Response mẫu khi **unhealthy**:
```json
{
  "success": true,
  "status": "unhealthy",
  "enabled": false,
  "botTokenSet": false,
  "chatIdSet": false,
  "intervalActive": false,
  "warnings": [
    "DATA_DIR not set - config may be lost on restart",
    "Telegram alerts disabled",
    "Bot token not configured",
    "Chat ID not configured",
    "Alert interval not running"
  ]
}
```

### 2. Kiểm tra Logs

Trong Render Dashboard → **Logs**, bạn sẽ thấy:

**Khi khởi động thành công:**
```
📂 DATA_DIR for telegram config: /var/data
📥 Loading telegram config from: /var/data/telegram-config.json
✅ Loaded Telegram config: { enabled: true, botToken: '***set***', ... }

⏱️  Scheduling telegram alert check in 30 seconds...
🚀 30 seconds elapsed, starting telegram alert system...

🔔 [TELEGRAM] Attempting to start alert interval...
   • Enabled: true
   • Bot Token: ***set***
   • Chat ID: 123456789
   • Refresh Interval: 15 minutes
   • Delay Threshold: 60 minutes
   • Alert Repeat: 1 minutes
   ✅ Alert interval STARTED
```

**Khi có vấn đề:**
```
⚠️  CẢNH BÁO: DATA_DIR chưa được set! Config telegram sẽ bị mất khi restart.
   → Vui lòng mount persistent disk và set DATA_DIR=/var/data

🔔 [TELEGRAM] Attempting to start alert interval...
   • Enabled: false
   • Bot Token: ❌ MISSING
   • Chat ID: ❌ MISSING
   ⚠️  Telegram alerts DISABLED in config
```

---

## 🔧 Cấu hình Telegram sau khi deploy

Nếu chưa cấu hình telegram trong environment variables, bạn có thể cấu hình qua web UI:

1. Đăng nhập vào app
2. Click vào **User menu** (góc trên bên phải)
3. Chọn **Cấu hình Telegram**
4. Nhập:
   - ✅ Bật cảnh báo Telegram
   - Bot Token (từ [@BotFather](https://t.me/BotFather))
   - Chat ID (gửi tin nhắn cho bot, rồi truy cập `/api/telegram/getupdates`)
   - Chu kỳ quét: 15 phút (khuyến nghị)
   - Điều kiện offline: 60 phút
   - Nhắc lại cảnh báo: 1 phút

5. Click **Lưu cấu hình**

Config sẽ được lưu vào `/var/data/telegram-config.json` (nếu đã mount persistent disk).

---

## 🐛 Troubleshooting

### Vấn đề: Telegram không gửi cảnh báo sau khi restart

**Nguyên nhân**: DATA_DIR chưa được set, config bị mất

**Giải pháp**:
1. Mount persistent disk tại `/var/data`
2. Set environment variable `DATA_DIR=/var/data`
3. Redeploy
4. Cấu hình lại telegram qua web UI

### Vấn đề: Alert interval không chạy

**Kiểm tra**:
1. Truy cập `/api/telegram/health`
2. Kiểm tra `intervalActive` = true
3. Kiểm tra logs có dòng "Alert interval STARTED"

**Nếu không chạy**:
- Kiểm tra `enabled` = true
- Kiểm tra `botToken` và `chatId` đã được set
- Restart service trong Render Dashboard

### Vấn đề: Container bị sleep trên Free plan

**Render Free plan** có thể sleep container sau 15 phút không có traffic.

**Giải pháp**:
1. Nâng cấp lên paid plan (khuyến nghị cho production)
2. Hoặc dùng external monitoring service để ping app mỗi 10 phút:
   - [UptimeRobot](https://uptimerobot.com/) (free)
   - [Cron-job.org](https://cron-job.org/) (free)
   
   Ping URL: `https://your-app.onrender.com/api/telegram/health`

---

## 📊 Monitoring

### Endpoints hữu ích:

- **Health Check**: `/api/telegram/health` - Kiểm tra trạng thái telegram alerts
- **Station Status**: `/api/stations` - Xem tất cả trạm
- **Stats**: `/api/stats` - Dữ liệu thống kê

### Logs quan trọng:

```bash
# Telegram alert được gửi
✅ [TELEGRAM] Đã gửi: GIẾNG SỐ 15 → offline (status_changed)

# Telegram snapshot khởi tạo
🛡️ [TELEGRAM] Snapshot khởi tạo: 23 trạm

# Lỗi gửi telegram
❌ [TELEGRAM] Lỗi gửi cho GIẾNG SỐ 18: connect ETIMEDOUT
```

---

## 🔐 Security Notes

- Không commit `.env` file vào Git
- Luôn dùng environment variables cho sensitive data
- JWT_SECRET nên là random string dài ít nhất 32 ký tự
- Định kỳ rotate bot token nếu bị lộ

---

## 📝 Checklist Deploy

- [ ] Tạo PostgreSQL database (Supabase/Render)
- [ ] Set DATABASE_URL environment variable
- [ ] Set NODE_ENV=production
- [ ] Set JWT_SECRET (random string)
- [ ] Mount persistent disk tại /var/data (cho telegram config)
- [ ] Set DATA_DIR=/var/data
- [ ] Deploy app
- [ ] Cấu hình Telegram qua web UI
- [ ] Kiểm tra `/api/telegram/health`
- [ ] Test gửi tin nhắn telegram
- [ ] Setup monitoring/ping service (nếu dùng free plan)

---

## 📞 Support

Nếu gặp vấn đề, kiểm tra:
1. Logs trong Render Dashboard
2. `/api/telegram/health` endpoint
3. Database connection status
4. Persistent disk mounted đúng chưa

Good luck! 🚀
