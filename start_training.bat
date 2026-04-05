@echo off
echo Starting 2048 AI Training Server...
echo This will train for 4 hours at maximum speed.
echo Open http://localhost:3000 in your browser to play.
echo Press Ctrl+C to stop and save progress.
echo.
node --max-old-space-size=2048 server.js
pause
