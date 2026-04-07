@echo off
setlocal
cd /d "%~dp0"

REM Use the SAME interpreter for pip and the script (avoids "pip satisfied" but import cv2 fails).
py -c "import cv2" 2>nul
if errorlevel 1 (
  echo [run-manifest] OpenCV missing for the Python behind "py". Installing...
  py -m pip install -r tools\requirements.txt
  if errorlevel 1 exit /b 1
)

py tools\generate-manifest.py
exit /b %ERRORLEVEL%
