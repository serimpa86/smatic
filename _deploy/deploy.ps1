param(
  [Parameter(Mandatory = $false)]
  [string]$Message = ""
)

$SSH_USER = "smatic"
$SSH_HOST = "ssh-smatic.alwaysdata.net"
$REMOTE_PATH = "/home/smatic"
$APP_NAME = "smatic"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY: Smatic -> alwaysdata.com" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Commit & Push to GitHub
if ($Message -ne "") {
  Write-Host "[1/3] Committing and pushing to GitHub..." -ForegroundColor Yellow
  git add -A
  git commit -m $Message
  git push
  Write-Host "  ✓ Done" -ForegroundColor Green
} else {
  Write-Host "[1/3] Skipping commit (no message provided)..." -ForegroundColor Yellow
  git push
  Write-Host "  ✓ Done" -ForegroundColor Green
}

Write-Host ""

# Step 2: SSH to server and pull latest code
Write-Host "[2/3] Updating code on alwaysdata server..." -ForegroundColor Yellow
ssh $SSH_USER@$SSH_HOST @"
  cd $REMOTE_PATH
  git pull origin main
  npm install --production
"@
Write-Host "  ✓ Done" -ForegroundColor Green

Write-Host ""

# Step 3: Restart PM2
Write-Host "[3/3] Restarting app with PM2..." -ForegroundColor Yellow
ssh $SSH_USER@$SSH_HOST "pm2 restart $APP_NAME && pm2 status"
Write-Host "  ✓ Done" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOY COMPLETED" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
