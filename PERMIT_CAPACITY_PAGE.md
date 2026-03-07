# Trang Công Suất theo Giấy Phép

## Tổng quan
Trang web mới hiển thị công suất hoạt động của các giếng và trạm bơm được nhóm theo giấy phép. Dữ liệu được tính từ chỉ số "Tổng lưu lượng" trong PostgreSQL của 30 ngày gần nhất.

## Cấu trúc Files

### Frontend Files (trong `public/`)
1. **permit-capacity.html** - Trang web chính
   - Header và sidebar integration
   - 3 summary cards: Tổng số giấy phép, trạm có dữ liệu, công suất
   - Container hiển thị chi tiết từng giấy phép
   - Nút refresh để cập nhật dữ liệu

2. **permit-capacity.css** - Styling
   - Card layout với grid responsive
   - Gradient headers cho permit cards
   - Progress bars hiển thị tỷ lệ công suất
   - Source badges (TVA/MQTT/SCADA) với màu sắc riêng
   - Mobile responsive breakpoints (768px, 480px)

3. **permit-capacity.js** - Frontend logic
   - Fetch dữ liệu từ API endpoint `/api/permit-capacity`
   - Render summary cards động
   - Tạo permit cards với stations tables
   - Format số và hiển thị progress bars
   - Loading và error handling

### Backend Files
1. **server.js** - API Endpoint
   - Route: `GET /api/permit-capacity` (với authentication)
   - Import functions từ list-stations-by-permit.js
   - Fetch stations từ MONRE API
   - Calculate capacity từ PostgreSQL
   - Return JSON với structure:
     ```json
     {
       "success": true,
       "timestamp": "2025-01-XX...",
       "totalStations": 42,
       "totalPermits": 4,
       "grandTotalCapacity": 202538.94,
       "data": {
         "35/gp-btnmt 15/01/2025": {...},
         "36/gp-btnmt 15/01/2025": {...},
         "391/gp-bnnmt 19/09/2025": {...},
         "393/gp-bnnmt 22/09/2025": {...}
       }
     }
     ```

2. **list-stations-by-permit.js** - Core Logic Module
   - Đã có sẵn và được export để dùng trong server.js
   - Functions:
     - `fetchAllStations()` - Lấy tất cả trạm từ MONRE API
     - `groupStationsByPermit()` - Nhóm trạm theo giấy phép
     - `calculateCapacityByPermitFromDB()` - Tính công suất từ PostgreSQL
     - `classifyStationByName()` - Phân loại trạm theo tên

### Navigation
1. **sidebar.html** - Thêm menu item mới
   - Icon: 3D box icon
   - Label: "Công suất theo Giấy phép"
   - Link: permit-capacity.html

2. **sidebar-loader.js** - Active state handling
   - Thêm case cho `permit-capacity.html` trong `setActiveMenuItem()`
   - Highlight menu khi đang ở trang này

## Dữ liệu Hiển thị

### Summary Cards (Tổng quan)
1. **Tổng số giấy phép**: 4 giấy phép
2. **Trạm có dữ liệu**: Số trạm có readings trong 30 ngày
3. **Tổng công suất**: Tổng lưu lượng của tất cả trạm (m³)

### Permit Cards (Chi tiết từng giấy phép)
Mỗi giấy phép hiển thị:
- **Header**: Tên giấy phép và ngày cấp
- **Stats**:
  - Công suất (m³) và % so với tổng
  - Số trạm có dữ liệu
- **Stations Table**:
  - STT
  - Tên trạm
  - Nguồn dữ liệu (TVA/MQTT/SCADA)
  - Lưu lượng tổng (m³)
  - Số records
  - Tỷ lệ % với progress bar
  - Giá trị đầu và giá trị cuối

## Authentication
- Trang yêu cầu đăng nhập
- Sử dụng JWT token trong localStorage
- Middleware: `verifyToken` trên API endpoint

## Testing

### 1. Test Backend Script
```bash
node list-stations-by-permit.js
```
Kết quả mong đợi:
- Console output với emoji icons
- File JSON: stations-by-permit.json, capacity-by-permit.json
- Tổng công suất: ~202,538.94 m³

### 2. Test API Endpoint
Start server:
```bash
node server.js
```
Test với curl (sau khi login để lấy token):
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/permit-capacity
```

### 3. Test Frontend
1. Mở trình duyệt: http://localhost:3000/permit-capacity.html
2. Đăng nhập nếu chưa
3. Kiểm tra:
   - Summary cards hiển thị đúng số liệu
   - Permit cards được render
   - Progress bars hoạt động
   - Nút refresh load lại dữ liệu
   - Responsive trên mobile

## Giấy Phép và Trạm

### GIẤY PHÉP 1: 35/gp-btnmt 15/01/2025
- Project: CAPNUOCCAMAU1
- Các trạm bơm (trừ TB21, TB26)

### GIẤY PHÉP 2: 36/gp-btnmt 15/01/2025
- Project: CAPNUOCCAMAUSO2
- Nhà máy cấp nước số 2

### GIẤY PHÉP 3: 391/gp-bnnmt 19/09/2025
- Project: CONGTYCOPHANCAPNUOCC
- Trạm bơm 21 (TB21)
- Trạm bơm 26 (TB26)

### GIẤY PHÉP 4: 393/gp-bnnmt 22/09/2025
- Project: NHAMAYCAPNUOCSO1
- Nhà máy cấp nước số 1

## Công Suất Hoạt Động
- **Định nghĩa**: Tổng lưu lượng trong 30 ngày gần nhất
- **Nguồn dữ liệu**: PostgreSQL tables (tva_data, mqtt_data, scada_data)
- **Parameter**: "Tổng lưu lượng"
- **Đơn vị**: m³ (mét khối)
- **Tính toán**: Giá trị cuối - Giá trị đầu của cùng một station_id

## Troubleshooting

### Lỗi "Không thể lấy dữ liệu"
- Kiểm tra server đang chạy
- Kiểm tra token JWT còn hạn
- Xem console logs trong server.js

### Không có dữ liệu công suất
- Kiểm tra PostgreSQL connection (config/index.js)
- Xác nhận có dữ liệu trong 30 ngày
- Chạy test script: node list-stations-by-permit.js

### Menu không highlight
- Xóa cache trình duyệt
- Kiểm tra sidebar-loader.js đã load
- F12 console xem logs

## Notes
- Trang tự động refresh khi click nút refresh
- Dữ liệu được sort theo công suất (cao nhất trước)
- Progress bars có animation smooth
- Responsive design hoạt động tốt trên mobile
- Loading spinner hiển thị khi fetch data
