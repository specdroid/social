# NotebookLM Auth Setup - Windows PowerShell
# Run this on your LOCAL Windows machine
# Then upload storage_state.json to VPS

Write-Host "=== NotebookLM Auth Setup (Windows) ===" -ForegroundColor Cyan
Write-Host ""

# Check Python
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "Python not found. Install from https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

# Install notebooklm-py
Write-Host ""
Write-Host "Installing notebooklm-py..." -ForegroundColor Yellow
pip install "notebooklm-py[browser]"

# Install Chromium
Write-Host ""
Write-Host "Installing Chromium..." -ForegroundColor Yellow
playwright install chromium

# Login
Write-Host ""
Write-Host "Opening browser for login..." -ForegroundColor Yellow
Write-Host "Sign in with war.peace.love@gmail.com" -ForegroundColor Cyan
notebooklm login

# Check auth file
$authFile = "$env:USERPROFILE\.notebooklm\profiles\default\storage_state.json"
if (Test-Path $authFile) {
    Write-Host ""
    Write-Host "Auth file found: $authFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Copy this file to your VPS:"
    Write-Host "   scp `"$authFile`" ubuntu@YOUR_VPS_IP:~/.notebooklm/profiles/default/storage_state.json"
    Write-Host ""
    Write-Host "2. On VPS, verify: notebooklm list"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Auth file not found. Login may have failed." -ForegroundColor Red
    Write-Host "Try running: notebooklm login" -ForegroundColor Yellow
}
