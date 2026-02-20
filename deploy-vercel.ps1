# Quick Deploy Script for Vercel
# Run this after setting JWT_SECRET on Vercel dashboard

Write-Host "🚀 VERCEL DEPLOYMENT SCRIPT" -ForegroundColor Cyan
Write-Host "============================`n" -ForegroundColor Cyan

# Check if vercel CLI is installed
$vercelInstalled = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelInstalled) {
    Write-Host "⚠️  Vercel CLI chưa được cài đặt" -ForegroundColor Yellow
    Write-Host "Đang cài đặt Vercel CLI...`n" -ForegroundColor Yellow
    npm install -g vercel
}

# Generate JWT_SECRET
Write-Host "🔐 Tạo JWT_SECRET mới:" -ForegroundColor Green
Write-Host "============================`n" -ForegroundColor Green

$jwtSecret = node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
Write-Host $jwtSecret -ForegroundColor Yellow
Write-Host "`n📋 Copy JWT_SECRET này vào Vercel Dashboard:" -ForegroundColor Cyan
Write-Host "   https://vercel.com/dashboard → Settings → Environment Variables`n" -ForegroundColor White

# Ask if JWT_SECRET has been set
Write-Host "❓ Đã set JWT_SECRET trên Vercel chưa? (y/n): " -ForegroundColor Cyan -NoNewline
$jwtSet = Read-Host

if ($jwtSet -eq 'y' -or $jwtSet -eq 'Y') {
    Write-Host "`n✅ Bắt đầu deploy...`n" -ForegroundColor Green
    
    # Deploy to Vercel
    Write-Host "🚀 Deploying to Vercel Production..." -ForegroundColor Cyan
    vercel --prod
    
    Write-Host "`n✅ DEPLOYMENT HOÀN TẤT!" -ForegroundColor Green
    Write-Host "============================`n" -ForegroundColor Green
    
    Write-Host "📝 NEXT STEPS:" -ForegroundColor Cyan
    Write-Host "1. Vào https://cncm-roan.vercel.app" -ForegroundColor White
    Write-Host "2. Mở F12 Console và chạy: localStorage.clear()" -ForegroundColor White
    Write-Host "3. Refresh page và login lại" -ForegroundColor White
    Write-Host "4. Test chuyển trang → Không bị đăng xuất!`n" -ForegroundColor White
    
} else {
    Write-Host "`n⚠️  Vui lòng set JWT_SECRET trước:" -ForegroundColor Yellow
    Write-Host "1. Vào: https://vercel.com/dashboard" -ForegroundColor White
    Write-Host "2. Chọn project → Settings → Environment Variables" -ForegroundColor White
    Write-Host "3. Add New: JWT_SECRET = (paste secret trên)" -ForegroundColor White
    Write-Host "4. Chạy lại script này`n" -ForegroundColor White
}

Write-Host "📚 Xem hướng dẫn chi tiết: VERCEL_DEPLOYMENT_FIX.md" -ForegroundColor Cyan
