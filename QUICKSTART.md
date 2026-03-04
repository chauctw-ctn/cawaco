# 🚀 Quick Start Guide

## Local Development

### 1. Clone & Install
```bash
git clone <repo-url>
cd cawaco
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Run
```bash
npm start
```

Visit: http://localhost:3000

---

## Deploy to Render

### Quick Steps

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Create Web Service on Render**
   - Connect your GitHub repo
   - Render auto-detects `render.yaml`

3. **Set Environment Variables**
   ```bash
   # Generate JWT Secret first
   npm run generate-secret
   ```
   
   Then add in Render:
   - `DATABASE_URL` → Your PostgreSQL connection string
   - `JWT_SECRET` → Generated secret from above

4. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment
   - Visit your app URL

---

## Useful Commands

```bash
# Generate JWT secret
npm run generate-secret

# Test database connection
npm run test:db

# Pre-deploy checks
npm run predeploy

# Start server
npm start
```

---

## Default Login

- Username: `admin`
- Password: `admin123`

⚠️ Change password after first login!

---

## Need Help?

- 📖 Read [README.md](./README.md) for full documentation
- 🚀 Read [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deploy guide
- ✅ Check [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) for quick checklist

---

**Công ty Cấp nước Cà Mau**
