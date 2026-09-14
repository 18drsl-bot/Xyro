@echo off
title Xyro local server - tags + editor (port 8619)
cd /d "%~dp0"
rem open the local tag editor in your default browser once the server is up
start "" cmd /c "timeout /t 1 /nobreak >nul & start "" http://localhost:8619/"
python _server.py
pause
