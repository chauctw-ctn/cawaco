# 🔧 FIX: Các trạm TVA không cập nhật trên Render

## ❌ Vấn đề
Khi deploy lên https://cncm.onrender.com, các trạm TVA không cập nhật dữ liệu.

## 🔍 Nguyên nhân
1. **Lệnh `exec('node getKeyTVA.js')` thất bại trên Render** - vì file system có thể read-only
2. **Không có error handling đúng** - lỗi bị nuốt không hiển thị
3. **Không có retry mechanism** - lỗi mạng tạm thời khiến cập nhật thất bại

## ✅ Giải pháp đã áp dụng

### 1. Thay đổi cách gọi hàm TVA crawl
**Trước đây** (server.js):
```javascript
exec('node getKeyTVA.js', async (error, stdout, stderr) => {
    // Gọi bằng child_process - dễ lỗi trên Render
});
```

**Bây giờ** (server.js):
```javascript
const { crawl: crawlTVAData } = require('./getKeyTVA');
// Import trực tiếp và gọi hàm
const allStations = await crawlTVAData();
```

### 2. Export hàm crawl từ getKeyTVA.js
**Thêm vào cuối file** (getKeyTVA.js):
```javascript
// Export hàm để server.js có thể import
module.exports = { crawl };

// Chỉ chạy nếu được gọi trực tiếp
if (require.main === module) {
  crawl();
}
```

### 3. Thêm retry logic
**Trong server.js**:
- Thử tối đa 3 lần nếu gặp lỗi
- Đợi 2s, 4s, 6s giữa các lần thử
- Log chi tiết từng lần thử

### 4. Xử lý lỗi ghi file trên Render
**Trong getKeyTVA.js**:
```javascript
try {
  fs.writeFileSync("data_quantrac.json", ...);
} catch (fileError) {
  console.warn("⚠️ Không thể lưu file (có thể do quyền ghi)");
  // Vẫn trả về dữ liệu để lưu vào database
}
```

### 5. Thêm API manual update cho admin
**Endpoint mới**:
```
POST /api/tva/update
Authorization: Bearer {token}
```
Admin có thể trigger cập nhật TVA thủ công để debug.

## 📝 Các bước deploy lại

### Bước 1: Commit code mới
```powershell
git add .
git commit -m "Fix: TVA stations not updating on Render - import crawl directly instead of exec"
git push origin main
```

### Bước 2: Render tự động deploy
- Render sẽ tự động phát hiện commit mới
- Quá trình build + deploy mất khoảng 2-3 phút
- Theo dõi logs tại: https://dashboard.render.com

### Bước 3: Kiểm tra logs
Sau khi deploy xong, vào **Logs** tab trên Render để xem:

✅ **Logs thành công sẽ hiển thị**:
```
🔄 Đang cập nhật dữ liệu TVA...
✅ Đã lấy 20 trạm TVA
💾 Đã lưu 340 bản ghi TVA vào database
```

❌ **Nếu vẫn lỗi, sẽ thấy**:
```
❌ Lỗi cập nhật TVA (lần thử 1/3): ...
⏳ Đợi 2s trước khi thử lại...
```

### Bước 4: Test trên web
1. Truy cập https://cncm.onrender.com
2. Login với admin account
3. Kiểm tra các trạm TVA có hiển thị dữ liệu mới không
4. Xem **last update time** của các trạm

### Bước 5: Manual update (nếu cần)
Nếu muốn force update ngay:
```javascript
// Gọi API từ browser console hoặc Postman
fetch('https://cncm.onrender.com/api/tva/update', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ADMIN_TOKEN',
    'Content-Type': 'application/json'
  }
})
.then(res => res.json())
.then(data => console.log(data));
```

## 🔍 Debug tips

### Kiểm tra TVA có cập nhật không:
```
GET https://cncm.onrender.com/api/stations/tva
```

Trong response, xem `updateTime` của từng trạm. Nếu `updateTime` cũ hơn 10 phút -> chưa cập nhật.

### Xem error logs chi tiết:
1. Vào Render Dashboard
2. Chọn service `camau-water-monitoring`
3. Click tab **Logs**
4. Filter: `TVA` hoặc `❌`

### Kiểm tra database có dữ liệu không:
```
GET https://cncm.onrender.com/api/stats
```

Xem `totalRecords` có tăng theo thời gian không.

## 🎯 Kết quả mong đợi

Sau khi fix:
- ✅ Dữ liệu TVA cập nhật mỗi 5 phút
- ✅ Có retry tự động khi lỗi tạm thời
- ✅ Log rõ ràng để debug
- ✅ Vẫn hoạt động khi không ghi được file
- ✅ Admin có thể trigger update thủ công

## 📞 Nếu vẫn gặp vấn đề

1. **Check network**: Đảm bảo Render có thể kết nối tới `camau.dulieuquantrac.com:8906`
2. **Check credentials**: Username/password trong getKeyTVA.js vẫn đúng
3. **Check logs**: Tìm error cụ thể trong Render logs
4. **Test locally**: Chạy `node getKeyTVA.js` trên máy local xem có lỗi không

## 📚 Tài liệu liên quan
- [DEPLOY_RENDER.md](DEPLOY_RENDER.md) - Hướng dẫn deploy lên Render
- [README_SERVER.md](README_SERVER.md) - Tài liệu về server
- [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) - Checklist deploy
