# Upload NotebookLM Auth to VPS
# Run this on your LOCAL Windows machine after login

$VPS_IP = "YOUR_VPS_IP"
$VPS_USER = "ubuntu"

Write-Host "=== Upload NotebookLM Auth to VPS ===" -ForegroundColor Cyan
Write-Host ""

$authFile = "$env:USERPROFILE\.notebooklm\profiles\default\storage_state.json"

if (-not (Test-Path $authFile)) {
    Write-Host "Auth file not found. Run notebooklm-login.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Uploading to VPS..." -ForegroundColor Yellow

# Create directory on VPS
ssh "$VPS_USER@$VPS_IP" "mkdir -p ~/.notebooklm/profiles/default"

# Upload file
scp $authFile "$VPS_USER@$VPS_IP`:~/.notebooklm/profiles/default/storage_state.json"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Upload successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "On VPS, verify with: notebooklm list" -ForegroundColor Yellow
} else {
    Write-Host "Upload failed." -ForegroundColor Red
}
