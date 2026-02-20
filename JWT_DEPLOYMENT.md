# JWT Authentication - Deployment Guide

## ✅ Đã Fix: Vấn đề đăng xuất khi chuyển trang trên Vercel/Render

### Vấn đề cũ:
- Token lưu trong **Map()** trên server memory
- Serverless functions (Vercel) hoặc multiple instances (Render) → Map bị reset
- User bị đăng xuất khi chuyển trang

### Giải pháp: JWT (JSON Web Token)
- **Stateless**: Không cần lưu token trên server
- **Hoạt động tốt** trên cả Vercel và Render
- Token hết hạn sau **7 ngày** tự động

---

## 🚀 Deployment Instructions

### 1️⃣ Render (https://render.com)

**Bước 1:** Vào Dashboard → Service của bạn → **Environment**

**Bước 2:** Thêm Environment Variable:
```
Key:   JWT_SECRET
Value: your-super-secret-key-here-change-this-in-production
```

**Bước 3:** Click **Save Changes** → Service sẽ tự động redeploy

**Lưu ý:**
- Dùng JWT_SECRET **KHÁC NHAU** cho development và production
- Tạo secret mạnh: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

### 2️⃣ Vercel (https://vercel.com)

**Bước 1:** Vào Dashboard → Project của bạn → **Settings** → **Environment Variables**

**Bước 2:** Thêm Environment Variable:
```
Variable Name:  JWT_SECRET
Value:          your-super-secret-key-here-change-this-in-production
Environment:    Production (hoặc chọn tất cả)
```

**Bước 3:** Click **Save** → Redeploy project:
```bash
# Trong terminal local
vercel --prod
```

Hoặc vào **Deployments** → chọn latest → **Redeploy**

---

## 🔐 Tạo JWT_SECRET an toàn

### Cách 1: Sử dụng Node.js
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Cách 2: Online Generator
- https://www.grc.com/passwords.htm
- Chọn 63 random printable ASCII characters

### Cách 3: PowerShell (Windows)
```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(64))
```

---

## 🧪 Test Local

### 1. Set environment variable (Windows PowerShell):
```powershell
$env:JWT_SECRET="your-test-secret-key"
npm start
```

### 2. Set environment variable (Linux/Mac):
```bash
export JWT_SECRET="your-test-secret-key"
npm start
```

### 3. Hoặc để mặc định (dùng config trong code):
```bash
npm start
# Sẽ dùng: 'camau-water-monitoring-secret-key-2026'
```

---

## ✅ Verification Checklist

Sau khi deploy, kiểm tra:

- [ ] Đăng nhập thành công
- [ ] Chuyển trang KHÔNG bị đăng xuất
- [ ] Refresh page vẫn giữ đăng nhập
- [ ] Token hết hạn sau 7 ngày (optional: test với JWT ngắn hạn)
- [ ] Logout hoạt động bình thường

---

## 🔧 Troubleshooting

### Vẫn bị đăng xuất?

**Kiểm tra:**
1. JWT_SECRET đã được set trên Render/Vercel chưa?
2. Đã redeploy sau khi set environment variable chưa?
3. Xem logs có lỗi "Invalid token" không?

**Fix nhanh:**
```bash
# Clear localStorage và login lại
# Trong browser console (F12):
localStorage.clear();
location.reload();
```

### Token expired?

Default là **7 ngày**. Nếu muốn thay đổi, sửa trong `server.js`:
```javascript
const JWT_EXPIRES_IN = '30d'; // 30 ngày
```

### Muốn revoke token ngay lập tức?

JWT không thể revoke được (by design). Nếu cần:
1. **Change JWT_SECRET** → tất cả token cũ sẽ invalid
2. **Implement token blacklist** (cần database/Redis)
3. **Giảm expiry time** xuống ngắn hơn (ví dụ: 1 ngày)

---

## 📊 So sánh: Map vs JWT

| Feature | Map (Cũ) | JWT (Mới) |
|---------|----------|-----------|
| Stateless | ❌ No | ✅ Yes |
| Vercel/Serverless | ❌ Fail | ✅ Work |
| Render Multi-instance | ❌ Fail | ✅ Work |
| Scalability | ❌ Poor | ✅ Excellent |
| Memory usage | ❌ High | ✅ Low |
| Logout immediate | ✅ Yes | ⚠️ No (token expiry) |

---

## 🌟 Best Practices

1. **KHÔNG hardcode JWT_SECRET** trong code (dùng env var)
2. **Dùng HTTPS** cho production (bắt buộc)
3. **Set expiry time hợp lý** (7-30 ngày cho web app)
4. **Rotate secret định kỳ** (mỗi 3-6 tháng)
5. **Monitor failed auth attempts** (để phát hiện attack)

---

## 📚 References

- JWT Introduction: https://jwt.io/introduction
- Express JWT: https://github.com/auth0/express-jwt
- Vercel Environment Variables: https://vercel.com/docs/projects/environment-variables
- Render Environment Variables: https://render.com/docs/environment-variables

---

**🎉 Hoàn thành!** JWT authentication đã sẵn sàng cho production trên cả Render và Vercel.
