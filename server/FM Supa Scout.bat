@echo off
rem One-click launcher: starts the scout server and opens it in your browser.
cd /d "%~dp0"
python -c "import numpy" 2>nul || python -m pip install --user numpy
python server.py
pause
