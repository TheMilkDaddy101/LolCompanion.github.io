@echo off
title LoL Companion
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js is not installed. Download it from https://nodejs.org (LTS) and run this again.
  pause
  exit /b 1
)
cd /d "%~dp0"
start "" http://localhost:3577
node server.js
pause
