# 🚀 HƯỚNG DẪN DEPLOY LÊN VERCEL - FIX LỖI ĐĂNG XUẤT

## ⚠️ Vấn đề hiện tại:
https://cncm-roan.vercel.app - Vẫn dùng code cũ (Map-based tokens) → bị đăng xuất khi chuyển trang

## ✅ Giải pháp: Deploy code JWT mới

---

## 📋 BƯỚC 1: Tạo JWT_SECRET mạnh

Chạy lệnh này để tạo secret key:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Copy kết quả** - bạn sẽ cần dùng ở bước 3.

Ví dụ output:
```
a7f8e9d6c5b4a3e2f1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4
```

---

## 📋 BƯỚC 2: Set Environment Variable trên Vercel

### Cách 1: Qua Dashboard (Khuyến nghị)

1. Vào https://vercel.com/dashboard
2. Chọn project: **cncm-roan** (hoặc tên project của bạn)
3. Vào **Settings** → **Environment Variables**
4. Click **Add New**:
   - **Name**: `JWT_SECRET`
   - **Value**: Paste secret key từ bước 1
   - **Environment**: Chọn **Production** (hoặc All nếu muốn)
5. Click **Save**

### Cách 2: Qua CLI

```bash
vercel env add JWT_SECRET
# Paste secret key khi được hỏi
# Chọn Production environment
```

---

## 📋 BƯỚC 3: Deploy Code Mới

### Option A: Deploy qua Git (Tự động - Khuyến nghị)

Nếu project đã link với GitHub:

```bash
# Commit code JWT mới
git add .
git commit -m "Fix: Add JWT authentication for Vercel/Render deployment"
git push origin main
```

→ Vercel sẽ **tự động deploy** trong 1-2 phút

### Option B: Deploy thủ công qua CLI

```bash
# Cài Vercel CLI nếu chưa có
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

### Option C: Deploy qua Dashboard

1. Vào https://vercel.com/dashboard
2. Chọn project **cncm-roan**
3. Vào tab **Deployments**
4. Click **Redeploy** trên deployment mới nhất
5. Đảm bảo chọn "Use existing Build Cache" TẮT (để rebuild)

---

## 📋 BƯỚC 4: Verify Deployment

### 4.1. Kiểm tra Build Log

Trong Vercel Dashboard → Deployments → Click vào deployment mới nhất:

✅ Cần thấy:
```
> Installing dependencies...
> jsonwebtoken@9.0.3 added
> Build Complete!
```

❌ Nếu thấy lỗi JWT_SECRET, quay lại Bước 2

### 4.2. Test API

Mở browser console (F12) và test:

```javascript
// Test verify endpoint
fetch('https://cncm-roan.vercel.app/api/verify', {
  headers: { 'Authorization': 'Bearer invalid-token' }
})
.then(r => r.json())
.then(console.log);

// Nên thấy: { success: false, message: "Invalid token" }
```

### 4.3. Test Login

1. Vào https://cncm-roan.vercel.app/login.html
2. Login với: `admin` / `admin123`
3. Sau khi login, **chuyển trang** (click menu)
4. ✅ **KHÔNG bị đăng xuất** = Thành công!

---

## 📋 BƯỚC 5: Clear Browser Cache (Quan trọng!)

Sau khi deploy xong:

### Chrome/Edge:
```
F12 → Console → Chạy:
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### Firefox:
```
F12 → Console → Chạy:
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Hoặc:
- Press `Ctrl + Shift + Del`
- Chọn "Cached images and files" + "Cookies and site data"
- Chọn "All time"
- Click "Clear data"

---

## 🔍 TROUBLESHOOTING

### Vấn đề 1: Vẫn bị đăng xuất

**Nguyên nhân**: Code cũ vẫn trong cache

**Giải pháp**:
1. Hard refresh: `Ctrl + Shift + R`
2. Clear localStorage (xem Bước 5)
3. Thử Incognito/Private mode
4. Kiểm tra deployment ID có mới nhất không

### Vấn đề 2: Login không được

**Kiểm tra**:
```javascript
// F12 Console
fetch('https://cncm-roan.vercel.app/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' })
})
.then(r => r.json())
.then(console.log);
```

**Nếu thấy lỗi JWT**: JWT_SECRET chưa được set → Quay lại Bước 2

### Vấn đề 3: 500 Internal Server Error

**Nguyên nhân**: Có thể là connection pool hoặc database config

**Giải pháp**: Thêm environment variables:
```
DATABASE_URL=<your-supabase-url>
NODE_ENV=production
```

### Vấn đề 4: Deployment Build Failed

**Kiểm tra**:
- Node version trong package.json: `"engines": { "node": "20.x" }`
- Xem build logs để tìm lỗi cụ thể
- Đảm bảo `jsonwebtoken` trong dependencies

---

## 📊 CHECKLIST HOÀN TẤT

- [ ] JWT_SECRET đã được set trên Vercel
- [ ] Code mới đã được deploy (check deployment timestamp)
- [ ] Build successful (xem build logs)
- [ ] Clear browser cache/localStorage
- [ ] Test login thành công
- [ ] Test chuyển trang KHÔNG bị đăng xuất
- [ ] Test logout hoạt động
- [ ] Test refresh page vẫn giữ login

---

## 🎯 Kết quả mong đợi:

```
TRƯỚC (Map-based):
Login → Chuyển trang → ❌ Đăng xuất (401 Invalid token)

SAU (JWT):
Login → Chuyển trang → ✅ Vẫn đăng nhập
Login → Refresh page → ✅ Vẫn đăng nhập
Login → Đóng tab → Mở lại → ✅ Vẫn đăng nhập (trong 7 ngày)
```

---

## 💡 LƯU Ý

1. **JWT_SECRET phải giống nhau** trên tất cả instances (nếu chạy nhiều deployment)
2. **KHÔNG commit JWT_SECRET** vào Git
3. **Dùng HTTPS** trong production (Vercel tự động có)
4. Token hết hạn sau **7 ngày** - user cần login lại
5. Nếu đổi JWT_SECRET, **tất cả users** sẽ bị logout

---

## 📞 Support

Nếu vẫn gặp vấn đề:
1. Check Vercel Function Logs
2. Check browser Console (F12)
3. Check Network tab (F12) để xem API responses
4. Đảm bảo đang test deployment MỚI NHẤT

---

**🎉 DONE!** Sau khi hoàn thành các bước trên, vấn đề đăng xuất khi chuyển trang sẽ được fix!
