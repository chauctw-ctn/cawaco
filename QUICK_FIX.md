# Quick Fix Guide - SQLite3 Build Issues

## Current Issue
"Could not locate the bindings file" - SQLite3 không được build đúng cách

## Solution Applied
✅ Sử dụng `node-pre-gyp` để tải pre-built binaries thay vì build from source

## Build Command Updated
```bash
npm install --production=false && npx node-pre-gyp install --fallback-to-build --directory=./node_modules/sqlite3
```

## Monitoring Deployment

### Expected Success Logs:
```
npm install --production=false
...
added 500+ packages
npx node-pre-gyp install --fallback-to-build
[sqlite3] Success: Downloaded pre-built binary
✅ Build completed

node server.js
✅ Đã kết nối tới SQLite database
🚀 Server đang chạy...
```

### If Still Fails:

#### Option 1: Clear Cache & Redeploy
1. Render Dashboard → Settings
2. Clear build cache
3. Manual Deploy → Deploy latest commit

#### Option 2: Use Simpler SQLite Package
Update `package.json`:
```json
"dependencies": {
  "better-sqlite3": "^9.4.0"  // Instead of sqlite3
}
```

Then update `database.js` first line:
```javascript
const Database = require('better-sqlite3');
const db = new Database('water_monitoring.db');
```

#### Option 3: Switch to PostgreSQL (RECOMMENDED)

**Why PostgreSQL:**
- ✅ No build issues
- ✅ Better for production
- ✅ Free tier on Render
- ✅ Automatic backups
- ✅ Better performance

**How to switch:**

1. Create PostgreSQL on Render:
   - Dashboard → New → PostgreSQL
   - Choose Free tier
   - Copy connection string

2. Install pg:
```bash
npm install pg
```

3. Update `database.js`:
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

4. Update `render.yaml`:
```yaml
services:
  - type: web
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: camau-water-db
          property: connectionString
```

## Current Status

**Deployment:** In progress
**Expected:** Will succeed with node-pre-gyp
**Fallback:** PostgreSQL migration ready if needed

## Verification

Once deployed, check:
```bash
curl https://your-app.onrender.com/api/stations
```

Should return:
```json
{
  "success": true,
  "totalStations": 30,
  ...
}
```

## Need Help?

If deployment fails again, run this locally to test:
```bash
npm install
npx node-pre-gyp install --directory=./node_modules/sqlite3
node server.js
```

---
**Last Updated:** 2026-02-02
**Build Method:** node-pre-gyp with pre-built binaries
