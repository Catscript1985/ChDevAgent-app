# ChDevAgent Windows 10 packaging scaffold
# Run in PowerShell from the chdevagent-agent directory.
$ErrorActionPreference = 'Stop'

Write-Host 'Preparing ChDevAgent Windows package...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20+ is required. Install it from https://nodejs.org/ before continuing.'
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out = Join-Path $root 'dist-windows'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item (Join-Path $root 'agent.mjs') $out -Force
Copy-Item (Join-Path $root 'package.json') $out -Force
Copy-Item (Join-Path $root 'README.md') $out -Force
Copy-Item (Join-Path $root 'public') (Join-Path $out 'public') -Recurse -Force
New-Item -ItemType Directory -Force -Path (Join-Path $out 'workspace') | Out-Null

@'
@echo off
setlocal
set CHDEVAGENT_PORT=8228
set HOST=0.0.0.0
set CHDEVAGENT_WORKSPACE=%~dp0workspace
node "%~dp0agent.mjs"
'@ | Set-Content (Join-Path $out 'Start-ChDevAgent.bat') -Encoding ascii

@'
ChDevAgent Windows 10 MVP

1. Install Node.js 20+.
2. Run Start-ChDevAgent.bat.
3. Copy the pairing code from the terminal.
4. On Android, open http://<THIS-PC-IP>:8228.
5. Keep Windows Firewall limited to Private networks only.
'@ | Set-Content (Join-Path $out 'INSTALL.txt') -Encoding utf8

Write-Host "Package prepared at $out"
Write-Host 'This scaffold intentionally uses Node.js rather than pretending a native EXE was built without a Windows build environment.'
