@echo off
color 0B
echo ===================================================
echo     CodeRunner Platform - Running Services
echo ===================================================
echo.

echo Ensure Redis Server (Port 6379) and PostgreSQL (Port 5432) are running!
echo.
pause

echo Starting Backend API Server...
cd backend
start "API Server" cmd /k "npm start"

timeout /t 2 /nobreak >nul

echo Starting Worker Node...
start "Worker Node" cmd /k "npm run worker"

echo Starting Frontend UI...
cd ..\frontend
start "React UI" cmd /k "npm run dev"

cd ..
echo.
echo ===================================================
echo Services launched in separate windows!
echo Keep all 3 CMD windows open.
echo Platform URL: http://localhost:5173
echo ===================================================
pause
