@echo off
color 0A
echo ===================================================
echo     CodeRunner Platform - Initial Setup Script
echo ===================================================
echo.

echo [1/4] Checking Node.js installation...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH. Please install Node.js.
    pause
    exit /b
)
echo Node.js is installed!
echo.

echo [2/4] Installing Backend Dependencies...
cd backend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b
)
echo.

echo [3/4] Running Database Migrations and Seeding (Make sure PostgreSQL is running!)...
call npm run migrate
call npm run seed
echo.

echo [4/4] Installing Frontend Dependencies...
cd ..\frontend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    pause
    exit /b
)
cd ..
echo.

echo ===================================================
echo   Setup Complete! You can now run the platform
echo   by executing the "run.bat" file.
echo ===================================================
pause
