# Builds build/app/FM-Supa-Scout-<version>.exe (portable, no Python needed on the target PC).
# Needs: Python 3.10+ with numpy + pyinstaller, Node 18+.   Run:  .\build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$srv = "$PSScriptRoot\server"
$pyLicense = python -c "import sys, os; print(os.path.join(sys.base_prefix, 'LICENSE.txt'))"  # PSF licence ships with the runtime

# 1. scan server -> build/server/fm-supa-scout-server/ (exe + runtime, web UI in ui/)
python -m PyInstaller --noconfirm --clean --onedir --name fm-supa-scout-server `
  --distpath build/server --workpath build/pyi --specpath build `
  --paths $srv --add-data "$srv\ui;ui" --add-data "$srv\layout.json;." `
  --add-data "$pyLicense;licenses/python" `
  "$srv\server.py"
if ($LASTEXITCODE) { throw 'PyInstaller failed' }

# 2. Electron shell around it -> build/app/FM-Supa-Scout-<version>.exe
Push-Location electron
try {
  npm install --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm install failed' }
  npx electron-builder --win portable
  if ($LASTEXITCODE) { throw 'electron-builder failed' }
} finally { Pop-Location }
Get-ChildItem build/app/*.exe | Select-Object Name, @{n = 'MB'; e = { [int]($_.Length / 1MB) } }
