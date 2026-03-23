@echo off
cd /d "%~dp0"
echo Checking Python installation...
python --version
echo.
echo Checking pip...
python -m pip --version
echo.
echo Checking Python location...
python -c "import sys; print('Python:', sys.executable)"
echo.
echo If you see errors above, visit: https://www.python.org/downloads/
echo Make sure to check "Add Python to PATH" during installation.
pause
