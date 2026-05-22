@echo off
title He Thong Ke Toan Noi Bo - Port 8080
cls

echo ====================================================================
echo    HE THONG KE TOAN NOI BO PREMIUM - KHOI DONG LOCALHOST (PORT 8080)
echo ====================================================================
echo.
echo [*] Dang chuan bi mo trinh duyet tai: http://localhost:8080...
start http://localhost:8080
echo.

:: Kiem tra Node.js
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [v] Phat hien Node.js. Dang khoi chay web server...
    echo.
    echo Bam Ctrl + C va chon Y de dung may chu.
    echo --------------------------------------------------------------------
    call npx -y http-server -p 8080
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [!] CANH BAO: Khoi chay bang Node.js that bai.
        echo Dang thu phuong an du phong bang Python...
        goto try_python
    )
    goto end
)

:try_python
:: Kiem tra Python
where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [v] Phat hien Python. Dang khoi chay web server du phong...
    echo.
    echo Bam Ctrl + C de dung may chu.
    echo --------------------------------------------------------------------
    python -m http.server 8080
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [X] LOI KHOI CHAY: Cong 8080 co the dang bi su dung boi ung dung khac.
    )
    goto end
)

echo.
echo [X] LOI: Khong tim thay ca Node.js va Python tren may tinh cua ban!
echo Vui long tai va cai dat Node.js tu: https://nodejs.org/
echo.

:end
echo.
echo Cua so nay se tam dung de ban doc thong bao loi (neu co).
echo Nhan phim bat ky de dong cua so...
pause > nul
