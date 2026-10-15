$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localRoot = Join-Path $repo '.local'
$pidDir = Join-Path $localRoot 'pids'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$dataDir = Join-Path $localRoot 'postgres\data'

function Stop-TrackedProcess([string]$PidFile, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PidFile)) { return }
  $saved = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
  $process = Get-Process -Id ([int]$saved.pid) -ErrorAction SilentlyContinue
  if ($process) {
    $actualStart = $process.StartTime.ToUniversalTime().Ticks
    $actualPath = [IO.Path]::GetFullPath($process.Path)
    $expectedPath = [IO.Path]::GetFullPath([string]$saved.node)
    if ($actualStart -eq [long]$saved.startedUtc -and $actualPath -ieq $expectedPath) {
      & taskkill.exe /PID ([int]$saved.pid) /T /F | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "Could not stop the tracked $Label process tree (PID $($saved.pid))." }
      Write-Output "Stopped $Label."
    } else {
      Write-Output "The saved $Label PID no longer identifies the process started by this project; left it untouched."
    }
  }
  Remove-Item -LiteralPath $PidFile -Force
}

Stop-TrackedProcess (Join-Path $pidDir 'web.json') 'web app'
Stop-TrackedProcess (Join-Path $pidDir 'api.json') 'API'
if (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION')) {
  & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDir -m fast -w stop
  if ($LASTEXITCODE -eq 0) { Write-Output 'Stopped the project-local PostgreSQL cluster. Database files were kept.' }
}
