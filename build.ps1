# Builds build/app/FM-Supa-Scout-<version>.exe (portable, no Python needed on the target PC).
# Needs: Python 3.10+ with numpy + pyinstaller, Node 18+.   Run:  .\build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ui = 'index.html', 'app.css', 'app.js', 'scout.js', 'discover.js', 'layout.json'
$data = $ui | ForEach-Object { '--add-data'; "$PSScriptRoot\$_;." }

python -m PyInstaller --noconfirm --clean --onedir --name fm-supa-scout-server `
  --distpath build/server --workpath build/pyi --specpath build @data server.py
if ($LASTEXITCODE) { throw 'PyInstaller failed' }

Push-Location electron
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm install failed' }
  npx electron-builder --win portable
  if ($LASTEXITCODE) { throw 'electron-builder failed' }
} finally { Pop-Location }
Get-ChildItem build/app/*.exe | Select-Object Name, @{n = 'MB'; e = { [int]($_.Length / 1MB) } }
