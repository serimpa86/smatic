param(
  [string]$Branch = "main"
)

$SSH_USER = "smatic"
$SSH_HOST = "ssh-smatic.alwaysdata.net"
$REMOTE_PATH = "/home/smatic"
$APP_NAME = "smatic"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  REDEPLOY: Smatic -> alwaysdata.com" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Pull latest code on server
Write-Host "[1/3] Pulling latest code..." -ForegroundColor Yellow
ssh $SSH_USER@$SSH_HOST "cd $REMOTE_PATH; git pull origin $Branch; npm install --production"
Write-Host "  Done" -ForegroundColor Green

Write-Host ""

# Step 2: Restart PM2
Write-Host "[2/3] Restarting app..." -ForegroundColor Yellow
ssh $SSH_USER@$SSH_HOST "pm2 restart $APP_NAME; pm2 status"
Write-Host "  Done" -ForegroundColor Green

Write-Host ""

# Step 3: Cross-check Git hash
Write-Host "[3/3] Verifying deployment..." -ForegroundColor Yellow
$localHash = & git rev-parse HEAD
$remoteHash = ssh $SSH_USER@$SSH_HOST "cd $REMOTE_PATH; git rev-parse HEAD"
if ($localHash -eq $remoteHash) {
  Write-Host "  Commit $localHash deployed successfully" -ForegroundColor Green
} else {
  Write-Host "  Local: $localHash" -ForegroundColor Red
  Write-Host "  Remote: $remoteHash" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  REDEPLOY COMPLETED" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
