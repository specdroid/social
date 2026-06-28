@echo off
echo Stopping all Node.js server instances...
taskkill /F /IM node.exe /T 2>nul
if %ERRORLEVEL%==0 (
    echo All Node.js processes terminated.
) else (
    echo No running Node.js processes found.
)
