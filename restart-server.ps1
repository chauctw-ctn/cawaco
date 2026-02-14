# Stop all Node.js processes
Write-Host "🛑 Stopping all Node.js processes..." -ForegroundColor Yellow
Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Cleanup test stations
Write-Host "`n🧹 Cleaning up test stations..." -ForegroundColor Cyan
node quick-cleanup.js

# Wait a moment
Start-Sleep -Seconds 2

# Start server
Write-Host "`n🚀 Starting server..." -ForegroundColor Green
node server.js
