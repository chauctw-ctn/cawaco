# Hệ Thống Quan Trắc Nước Ngầm - Công ty Cấp nước Cà Mau

Hệ thống web theo dõi và giám sát chất lượng nước ngầm từ các trạm quan trắc tại Cà Mau.

## 🚀 Tính năng

- 🗺️ Hiển thị bản đồ các trạm quan trắc theo thời gian thực
- 📊 Thống kê và phân tích dữ liệu theo thời gian
- 📈 Biểu đồ chất lượng nước
- 🔔 Cảnh báo qua Telegram khi trạm offline
- 👥 Quản lý người dùng và phân quyền
- 🔐 Xác thực bảo mật với JWT

## 📋 Công nghệ

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL (Supabase)
- **Real-time**: MQTT Protocol
- **Frontend**: Vanilla JavaScript, Google Maps API
- **Authentication**: JWT (JSON Web Tokens)

## 🛠️ Cài đặt Local

### Yêu cầu

- Node.js 20.x trở lên
- PostgreSQL database (hoặc Supabase)
- MQTT Broker access

### Các bước cài đặt

1. **Clone repository**
```bash
git clone <repository-url>
cd cawaco
```

2. **Cài đặt dependencies**
```bash
npm install
```

3. **Cấu hình biến môi trường**

Tạo file `.env` từ file mẫu:
```bash
cp .env.example .env
```

Chỉnh sửa file `.env` với thông tin của bạn:
- `DATABASE_URL`: Connection string PostgreSQL
- `JWT_SECRET`: Secret key cho JWT (tạo random string mạnh)
- Các thông tin đăng nhập TVA, SCADA
- Telegram bot token (nếu dùng cảnh báo)

4. **Khởi động server**
```bash
npm start
```

Server sẽ chạy tại `http://localhost:3000`

## 🌐 Deploy trên Render

### Chuẩn bị

1. **Tạo PostgreSQL Database trên Supabase** (hoặc Render PostgreSQL)
   - Lấy connection string
   - Database sẽ tự động khởi tạo tables khi server start

2. **Push code lên GitHub**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo>
git push -u origin main
```

### Deploy

1. **Tạo Web Service trên Render**
   - Đăng nhập [render.com](https://render.com)
   - Chọn "New" → "Web Service"
   - Kết nối GitHub repository của bạn
   - Render sẽ tự động phát hiện `render.yaml`

2. **Cấu hình Environment Variables**

   Trong Render Dashboard, thêm các biến môi trường sau:

   **Bắt buộc:**
   - `DATABASE_URL`: PostgreSQL connection string
   - `JWT_SECRET`: Secret key mạnh (tạo random)

   **Tùy chọn:** (nếu không set sẽ dùng giá trị mặc định trong config)
   - `TVA_USERNAME`: Tên đăng nhập hệ thống TVA
   - `TVA_PASSWORD`: Mật khẩu TVA
   - `SCADA_USERNAME`: Tên đăng nhập SCADA
   - `SCADA_PASSWORD`: Mật khẩu SCADA
   - `TELEGRAM_BOT_TOKEN`: Bot token để gửi cảnh báo
   - `TELEGRAM_CHAT_ID`: Chat ID nhận cảnh báo

   **Lưu ý**: PORT được Render tự động set, không cần cấu hình.

3. **Deploy**
   - Render sẽ tự động build và deploy
   - Kiểm tra logs để đảm bảo không có lỗi
   - Health check endpoint: `/api/stations`

### Cấu hình render.yaml

File `render.yaml` đã được cấu hình sẵn với:
- Node.js 20
- Auto-deploy khi push code
- Health check
- Persistent disk (1GB) cho lưu trữ
- Environment variables

### Monitoring

- **Health Check**: Render tự động ping `/api/stations`
- **Logs**: Xem logs realtime trong Render Dashboard
- **Database**: Monitor qua Supabase Dashboard

## 📊 API Endpoints

### Authentication
- `POST /api/login` - Đăng nhập
- `POST /api/logout` - Đăng xuất
- `GET /api/verify` - Xác thực token
- `POST /api/change-password` - Đổi mật khẩu

### Stations Data
- `GET /api/stations` - Lấy tất cả trạm
- `GET /api/stations/tva` - Trạm TVA
- `GET /api/stations/mqtt` - Trạm MQTT
- `GET /api/station/:id` - Chi tiết trạm

### Statistics
- `GET /api/stats` - Dữ liệu thống kê
- `GET /api/stats/parameters` - Danh sách thông số
- `GET /api/stats/stations` - Danh sách trạm

### SCADA
- `GET /api/scada/stations` - Dữ liệu SCADA
- `GET /api/scada/cached` - Dữ liệu SCADA cached
- `POST /api/scada/update` - Cập nhật SCADA (admin)

### Telegram Alerts
- `GET /api/telegram/config` - Lấy cấu hình
- `POST /api/telegram/config` - Cập nhật cấu hình (admin)
- `POST /api/telegram/test` - Test gửi tin nhắn

### Visitor Tracking
- `POST /api/visitors/register` - Đăng ký visit
- `GET /api/visitors/stats` - Thống kê visitors

## 🔐 Tài khoản mặc định

**Admin:**
- Username: `admin`
- Password: `admin123`

**User:**
- Username: `user`
- Password: `user123`

⚠️ **Lưu ý**: Đổi mật khẩu sau khi đăng nhập lần đầu!

## 🗃️ Database Schema

Database sẽ tự động tạo các bảng:
- `tva_data` - Dữ liệu trạm TVA
- `mqtt_data` - Dữ liệu trạm MQTT
- `scada_data` - Dữ liệu SCADA
- `visitor_stats` - Thống kê truy cập

Dữ liệu cũ hơn 90 ngày sẽ tự động xóa để tiết kiệm dung lượng.

## 🔄 Cập nhật tự động

- **TVA**: Cập nhật mỗi 5 phút
- **MQTT**: Lưu vào DB mỗi 1 phút
- **SCADA**: Cập nhật mỗi 5 phút
- **Cleanup**: Dọn dẹp dữ liệu cũ mỗi 24 giờ

## 📱 Tính năng Telegram

Hệ thống có thể gửi cảnh báo qua Telegram khi:
- Trạm mất kết nối (offline)
- Trạm kết nối lại (online)

Cấu hình qua giao diện web (chỉ admin).

## 🐛 Troubleshooting

### Database Connection Error
- Kiểm tra `DATABASE_URL` có đúng không
- Đảm bảo database cho phép kết nối từ Render IP
- Kiểm tra SSL settings trong config

### MQTT Not Connecting
- Kiểm tra firewall/network
- Xác nhận MQTT broker accessible
- Server vẫn hoạt động nhưng không có data realtime

### Deployment Failed
- Kiểm tra Node.js version (phải 20.x)
- Xem build logs trên Render
- Đảm bảo tất cả dependencies trong package.json

## 📝 Logs

Xem logs trên Render Dashboard để monitor:
- Connection status (TVA, MQTT, SCADA, Database)
- Data updates
- Errors và warnings
- API requests

## 🤝 Support

Liên hệ: Công ty Cấp nước Cà Mau
- Địa chỉ: 204 Quang Trung, P. Tân Thành, Cà Mau
- Hotline: 02903 836 360

## 📄 License

ISC License - Công ty Cấp nước Cà Mau
