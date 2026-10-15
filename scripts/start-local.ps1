$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localRoot = Join-Path $repo '.local'
$dataDir = Join-Path $localRoot 'postgres\data'
$logDir = Join-Path $localRoot 'logs'
$pidDir = Join-Path $localRoot 'pids'
$apiPidFile = Join-Path $pidDir 'api.json'
$webPidFile = Join-Path $pidDir 'web.json'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'

function Get-LocalPort([string]$Name, [int]$Default) {
  $raw = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  $parsed = 0
  if (-not [int]::TryParse($raw, [ref]$parsed) -or $parsed -lt 1024 -or $parsed -gt 65535) {
    throw "$Name must be a TCP port between 1024 and 65535."
  }
  return $parsed
}

$dbPort = Get-LocalPort 'ERP_LOCAL_DB_PORT' 5434
$apiPort = Get-LocalPort 'ERP_LOCAL_API_PORT' 4001
$webPort = Get-LocalPort 'ERP_LOCAL_WEB_PORT' 3002
$databaseName = 'brick_erp_local'
$databaseUrl = "postgresql://postgres@127.0.0.1:$dbPort/$databaseName"
$postgresLog = $env:ERP_LOCAL_PG_LOG
if ([string]::IsNullOrWhiteSpace($postgresLog)) {
  $postgresLog = Join-Path $logDir 'postgres-local.log'
} elseif (-not [IO.Path]::IsPathRooted($postgresLog)) {
  $postgresLog = Join-Path $repo $postgresLog
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

function Test-ListeningPort([int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(350) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Assert-NativeSuccess([string]$Name) {
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'initdb.exe'))) {
  throw "PostgreSQL 18 tools were not found under $pgBin. Install PostgreSQL 18 or update scripts/start-local.ps1 to the installed version."
}
if (Test-ListeningPort $apiPort) { throw "Port $apiPort is already in use. Stop the existing API before running local:start." }
if (Test-ListeningPort $webPort) { throw "Port $webPort is already in use. Stop the existing web app before running local:start." }

New-Item -ItemType Directory -Force -Path (Split-Path $dataDir), $logDir, $pidDir, (Split-Path $postgresLog) | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION'))) {
  $existingFiles = @(Get-ChildItem -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue)
  if ($existingFiles.Count -gt 0) { throw "The local PostgreSQL data path is non-empty but is not an initialized database: $dataDir" }
  & (Join-Path $pgBin 'initdb.exe') -D $dataDir -U postgres -A trust --encoding=UTF8 --no-locale
  Assert-NativeSuccess 'initdb'
}

$pgStatus = & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir status 2>&1
if ($LASTEXITCODE -ne 0) {
  if (Test-ListeningPort $dbPort) { throw "Port $dbPort is already in use by another service. The project-local database was not started." }
  & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -l $postgresLog -o "-h 127.0.0.1 -p $dbPort -c listen_addresses=127.0.0.1" -w start
  Assert-NativeSuccess 'PostgreSQL start'
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $dbPort *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw "Project-local PostgreSQL did not become ready on 127.0.0.1:$dbPort. See $postgresLog." }

$databaseExists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $dbPort -U postgres -d postgres -A -t -c "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
Assert-NativeSuccess 'Database existence check'
if ([string]::IsNullOrWhiteSpace([string]$databaseExists) -or $databaseExists.Trim() -ne '1') {
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $dbPort -U postgres $databaseName
  Assert-NativeSuccess 'Database creation'
}

$env:DATABASE_URL = $databaseUrl
$env:NODE_ENV = 'development'
$env:PORT = "$apiPort"
$env:API_HOST = '127.0.0.1'
$env:WEB_ORIGIN = "http://localhost:$webPort,http://127.0.0.1:$webPort"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$apiPort"
if ([string]::IsNullOrWhiteSpace($env:ERP_LOCAL_NEXT_DIST_DIR)) {
  $env:ERP_NEXT_DIST_DIR = '.next-local'
} else {
  $env:ERP_NEXT_DIST_DIR = $env:ERP_LOCAL_NEXT_DIST_DIR
}
foreach ($key in @('OBJECT_STORAGE_ENDPOINT','OBJECT_STORAGE_BUCKET','OBJECT_STORAGE_REGION','OBJECT_STORAGE_ACCESS_KEY_ID','OBJECT_STORAGE_SECRET_ACCESS_KEY','OBJECT_STORAGE_SESSION_TOKEN')) {
  [Environment]::SetEnvironmentVariable($key, '', 'Process')
}

Push-Location $repo
try {
  & npm.cmd run db:migrate
  Assert-NativeSuccess 'Database migrations'
  & npm.cmd run db:status
  Assert-NativeSuccess 'Database migration status'
} finally {
  Pop-Location
}

$apiStdout = Join-Path $logDir 'api.stdout.log'
$apiStderr = Join-Path $logDir 'api.stderr.log'
$apiProcess = Start-Process -FilePath $nodePath -ArgumentList @('--import','tsx','backend/src/server.ts') -WorkingDirectory $repo -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiStdout -RedirectStandardError $apiStderr
$apiProcess.Refresh()
if ($apiProcess.HasExited) { throw "API exited during startup. Check $apiStderr." }
[pscustomobject]@{ pid = $apiProcess.Id; startedUtc = $apiProcess.StartTime.ToUniversalTime().Ticks; node = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath $apiPidFile -Encoding utf8

$apiHealthy = $false
for ($i = 0; $i -lt 40; $i++) {
  $apiProcess.Refresh()
  if ($apiProcess.HasExited) { throw "API exited before its health check passed. Review $apiStderr." }
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.database -eq 'ok') { $apiHealthy = $true; break }
  } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $apiHealthy) { throw "API/database health check failed. Review $apiStderr and $apiStdout." }

$nextCli = Join-Path $repo 'node_modules\next\dist\bin\next'
$webProcess = Start-Process -FilePath $nodePath -ArgumentList @("`"$nextCli`"",'dev','--hostname','127.0.0.1','--port',"$webPort") -WorkingDirectory (Join-Path $repo 'frontend') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'web.stdout.log') -RedirectStandardError (Join-Path $logDir 'web.stderr.log')
$webProcess.Refresh()
if ($webProcess.HasExited) { throw "Web app exited during startup. Check $($logDir)\web.stderr.log." }
[pscustomobject]@{ pid = $webProcess.Id; startedUtc = $webProcess.StartTime.ToUniversalTime().Ticks; node = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath $webPidFile -Encoding utf8

$webReady = $false
for ($i = 0; $i -lt 90; $i++) {
  $webProcess.Refresh()
  if ($webProcess.HasExited) { throw "Web app exited before returning HTTP 200. Review $($logDir)\web.stderr.log." }
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -TimeoutSec 2 -UseBasicParsing
    if ($response.StatusCode -eq 200) { $webReady = $true; break }
  } catch { Start-Sleep -Seconds 1 }
}
if (-not $webReady) { throw "Web app did not return HTTP 200. Review $($logDir)\web.stderr.log." }

$setupStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/auth/setup-status" -TimeoutSec 5
Write-Output "ERP is running at http://localhost:$webPort/"
Write-Output "Database: $databaseName on 127.0.0.1:$dbPort; migrations are current."
if ($setupStatus.setupRequired -eq $true) {
  Write-Output "First-time Owner setup is ready at http://localhost:$webPort/setup. Create the Owner account there; no database password is required."
} else {
  Write-Output 'First-time setup is already complete in this project-local database.'
}
Write-Output "Logs are under $localRoot\logs. Stop with: npm.cmd run local:stop"
