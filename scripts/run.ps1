# Local.Qkview -- start backend + frontend, tail logs, Ctrl+C stops both.
# Assumes one-time install has been done (see README.md).

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot

if (-not (Test-Path (Join-Path $RepoRoot '.venv'))) {
    Write-Error '.venv\ not found. Run the install steps in README.md first.'
    exit 1
}
if (-not (Test-Path (Join-Path $RepoRoot 'webapp\.next'))) {
    Write-Error 'webapp\.next not found. Run ''cd webapp; npm run build'' first.'
    exit 1
}

$venvActivate = Join-Path $RepoRoot '.venv\Scripts\Activate.ps1'
. $venvActivate

Write-Host 'Starting backend on http://127.0.0.1:8000 ...'
$backend = Start-Process -FilePath 'uvicorn' `
    -ArgumentList 'main:app','--host','127.0.0.1','--port','8000' `
    -WorkingDirectory (Join-Path $RepoRoot 'backend') `
    -NoNewWindow -PassThru

Start-Sleep -Seconds 2

Write-Host 'Starting frontend on http://127.0.0.1:3000 ...'
$webapp = Start-Process -FilePath 'npm' `
    -ArgumentList 'run','start' `
    -WorkingDirectory (Join-Path $RepoRoot 'webapp') `
    -NoNewWindow -PassThru

Write-Host ''
Write-Host 'Local.Qkview is running. Open http://localhost:3000 -- Ctrl+C to stop.'

try {
    Wait-Process -Id $backend.Id, $webapp.Id
}
finally {
    Write-Host ''
    Write-Host 'Stopping services...'
    if (-not $backend.HasExited) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
    if (-not $webapp.HasExited)  { Stop-Process -Id $webapp.Id  -Force -ErrorAction SilentlyContinue }
}
