# ✅ Quick Deploy Checklist

## Trước Khi Deploy

- [ ] Test local: `npm start` chạy OK
- [ ] Database: Có Supabase connection string
- [ ] Git: Code đã commit và push lên GitHub

## Environment Variables Cần Thiết

### Bắt Buộc
- [ ] `DATABASE_URL` - PostgreSQL connection string
- [ ] `JWT_SECRET` - Random string mạnh (32+ chars)

### Tùy Chọn
- [ ] `TVA_USERNAME` / `TVA_PASSWORD`
- [ ] `SCADA_USERNAME` / `SCADA_PASSWORD`
- [ ] `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`

## Deploy Steps

1. [ ] Tạo Web Service trên Render.com
2. [ ] Connect GitHub repository
3. [ ] Thêm Environment Variables
4. [ ] Click "Create Web Service"
5. [ ] Đợi deploy xong (xem logs)

## Sau Deploy

- [ ] Health check: `/api/stations` returns 200 OK
- [ ] Website accessible
- [ ] Đăng nhập admin/admin123
- [ ] Đổi password admin
- [ ] Kiểm tra data hiển thị đúng

## Troubleshooting

**Build failed?**
→ Check logs, verify Node.js version in package.json

**Database error?**
→ Verify DATABASE_URL format and credentials

**App sleeping (free tier)?**
→ Setup cron job to ping every 10 mins or upgrade plan

---

📖 Chi tiết: Đọc [DEPLOYMENT.md](./DEPLOYMENT.md)
