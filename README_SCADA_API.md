# 🏭 API SCADA TVA - Hướng Dẫn Sử Dụng

## 📋 Thông Tin Hệ Thống SCADA
- **URL**: http://14.161.36.253:86/Scada/Login.aspx
- **Username**: cncamau
- **Password**: cm123456
- **Loại**: ASP.NET WebForms SCADA System

---

## 🔌 API Endpoints

### 1. Lấy Dữ Liệu Trạm Realtime
```http
GET /api/scada/stations
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-02-03T10:30:00.000Z",
  "count": 15,
  "data": [
    {
      "id": "ST001",
      "name": "Trạm Quan Trắc 1",
      "location": "Cà Mau",
      "status": "Online",
      "lastUpdate": "2026-02-03 10:29:00"
    }
  ]
}
```

**Ví dụ sử dụng:**
```javascript
// JavaScript
fetch('/api/scada/stations')
  .then(res => res.json())
  .then(data => {
    console.log(`Số trạm: ${data.count}`);
    console.log(data.data);
  });
```

```bash
# cURL
curl http://localhost:3000/api/scada/stations
```

---

### 2. Lấy Chi Tiết Một Trạm
```http
GET /api/scada/station/:id
```

**Parameters:**
- `id` (string): ID của trạm cần lấy thông tin

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-02-03T10:30:00.000Z",
  "data": {
    "id": "ST001",
    "name": "Trạm Quan Trắc 1",
    "parameters": {
      "waterLevel": 2.5,
      "temperature": 28.5,
      "ph": 7.2
    }
  }
}
```

**Ví dụ:**
```javascript
fetch('/api/scada/station/ST001')
  .then(res => res.json())
  .then(data => console.log(data.data));
```

---

### 3. Lấy Dữ Liệu Cache (Nhanh)
```http
GET /api/scada/cached
```

**Mô tả:** Lấy dữ liệu đã cache từ file `data_scada_tva.json` (không cần crawl lại)

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-02-03T10:25:00.000Z",
  "source": "SCADA_TVA",
  "stations": [...]
}
```

**Sử dụng khi:**
- Cần hiển thị nhanh
- Không cần dữ liệu realtime tuyệt đối
- Giảm tải cho hệ thống SCADA

---

### 4. Cập Nhật Dữ Liệu (Admin Only)
```http
POST /api/scada/update
```

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "message": "Đã cập nhật dữ liệu SCADA thành công",
  "count": 15
}
```

**Ví dụ:**
```javascript
fetch('/api/scada/update', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
.then(res => res.json())
.then(data => console.log(data.message));
```

---

## 🧪 Test API Locally

### Bước 1: Chạy test trực tiếp
```bash
node scada-tva-crawler.js
```

### Bước 2: Khởi động server
```bash
npm start
```

### Bước 3: Test API
```bash
# Test lấy dữ liệu realtime
curl http://localhost:3000/api/scada/stations

# Test lấy cache
curl http://localhost:3000/api/scada/cached

# Test chi tiết trạm
curl http://localhost:3000/api/scada/station/ST001
```

---

## 📊 Cấu Trúc Dữ Liệu

### Station Object
```typescript
interface Station {
  id: string;           // ID trạm
  name: string;         // Tên trạm
  location: string;     // Vị trí
  status: string;       // Trạng thái: Online/Offline
  lastUpdate: string;   // Thời gian cập nhật cuối
  // Các trường khác tùy theo hệ thống SCADA
}
```

---

## ⚠️ Lưu Ý Quan Trọng

### 1. Điều chỉnh HTML Selectors
File `scada-tva-crawler.js` cần điều chỉnh các selector CSS theo cấu trúc HTML thực tế của hệ thống SCADA:

```javascript
// Tìm bảng dữ liệu
$dashboard('table[id*="GridView"]').each((i, table) => {
  // ... parse data
});
```

**Cần làm:**
1. Truy cập http://14.161.36.253:86/Scada/Login.aspx
2. Đăng nhập và xem source HTML
3. Tìm ID/class của bảng dữ liệu
4. Cập nhật selector trong code

### 2. Xử lý ASP.NET ViewState
Hệ thống ASP.NET WebForms sử dụng ViewState - code đã xử lý sẵn:
```javascript
const viewState = $('input[name="__VIEWSTATE"]').val();
const eventValidation = $('input[name="__EVENTVALIDATION"]').val();
```

### 3. Session Management
- Session cookie được tự động quản lý
- Timeout thường là 20-30 phút
- Code tự động login lại nếu cần

### 4. Performance
- **Realtime API** (`/api/scada/stations`): ~5-10 giây (crawl + login)
- **Cached API** (`/api/scada/cached`): ~50ms (đọc file)
- **Khuyến nghị**: Dùng cached API cho display, update mỗi 5-10 phút

---

## 🔄 Auto Update (Tùy Chọn)

Thêm vào `server.js` để tự động cập nhật:

```javascript
// Auto update SCADA data mỗi 10 phút
setInterval(async () => {
    try {
        console.log('🔄 Auto updating SCADA data...');
        await crawlScadaTVA();
        console.log('✅ SCADA data updated');
    } catch (error) {
        console.error('❌ SCADA auto update failed:', error.message);
    }
}, 10 * 60 * 1000); // 10 minutes
```

---

## 🐛 Troubleshooting

### Lỗi: "Không thể lấy ViewState"
- Kiểm tra URL login có đúng không
- Kiểm tra hệ thống SCADA có hoạt động không
- Xem HTML source để tìm input ViewState

### Lỗi: Login thất bại
- Kiểm tra username/password
- Kiểm tra tên input fields trong form login
- Có thể cần thêm captcha handling

### Lỗi: Không parse được dữ liệu
- Cập nhật CSS selectors theo HTML thực tế
- Kiểm tra cấu trúc bảng dữ liệu
- Thử tìm API endpoint JSON thay vì parse HTML

---

## 📞 Support
Nếu cần hỗ trợ điều chỉnh code theo cấu trúc SCADA thực tế, vui lòng cung cấp:
1. Screenshot giao diện sau khi login
2. HTML source của trang dữ liệu
3. Network tab (F12) để xem các API calls

---
📅 Cập nhật: February 3, 2026
