@echo off
cd /d "%~dp0"
start "FX Platform Server" /min python -m http.server 8010 --bind 127.0.0.1
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8010/admin.html
