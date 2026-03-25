@echo off
chcp 65001 >nul
echo Installing dependencies...
pip install -r requirements.txt -q
echo Building frontend...
call npm install >nul 2>&1
call npm run build >nul 2>&1
echo Starting server...
start http://localhost:3000
python run.py
