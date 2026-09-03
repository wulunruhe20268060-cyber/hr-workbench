# HR工作台 一键部署脚本
# 用法: 右键 setup.ps1 → "使用 PowerShell 运行"
# 或: powershell -ExecutionPolicy Bypass -File setup.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HR 工作台 一键部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# 1. 解压项目文件
Write-Host "[1/4] 解压项目文件..." -ForegroundColor Yellow
if (Test-Path hr-workbench-full.tar.gz) {
    tar -xzf hr-workbench-full.tar.gz
    Write-Host "  ✓ 解压完成" -ForegroundColor Green
} else {
    Write-Host "  ✗ 找不到 hr-workbench-full.tar.gz，请确保文件在当前目录" -ForegroundColor Red
    exit 1
}

# 2. 安装 Node.js 依赖
Write-Host "[2/4] 检查 Node.js..." -ForegroundColor Yellow
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
    Write-Host "  ✗ 未安装 Node.js，请先安装 https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green

# 3. 安装 PM2（如未安装）
Write-Host "[3/4] 检查 PM2..." -ForegroundColor Yellow
$pm2Version = pm2 -v 2>$null
if (-not $pm2Version) {
    Write-Host "  正在安装 PM2..." -ForegroundColor Yellow
    npm install -g pm2
    Write-Host "  ✓ PM2 安装完成" -ForegroundColor Green
} else {
    Write-Host "  ✓ PM2 v$pm2Version" -ForegroundColor Green
}

# 4. 启动服务（端口 80）
Write-Host "[4/4] 启动服务..." -ForegroundColor Yellow
$env:PORT = "80"
pm2 start server.js --name hr-workbench
pm2 save
pm2 startup | Invoke-Expression

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  访问地址: http://localhost" -ForegroundColor White
Write-Host "  管理员:   admin / admin123" -ForegroundColor White
Write-Host "  合同管理员: wangyan / 123456" -ForegroundColor White
Write-Host "  普通成员: zhangwei / 123456" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "按任意键退出..." 
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
