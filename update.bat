@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set WEBHOOK=
set REPO=mckenziii/The-Twink-Community-Hub

echo Enter commit message:
set /p MSG=

if "%MSG%"=="" (
    echo No message entered.
    pause
    exit /b
)

set FILES=
for /f "delims=" %%A in ('git diff --name-only') do (
    set FILES=!FILES!%%A\n
)

if "!FILES!"=="" (
    set FILES=No changed files
)

if not exist version.txt (
    echo v0.0.0>version.txt
)

set /p VERSION=<version.txt

set VER=%VERSION:v=%

for /f "tokens=1,2,3 delims=." %%a in ("%VER%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

set /a PATCH+=1

if !PATCH! GEQ 10 (
    set PATCH=0
    set /a MINOR+=1
)

if !MINOR! GEQ 10 (
    set MINOR=0
    set /a MAJOR+=1
)

set NEWVERSION=v!MAJOR!.!MINOR!.!PATCH!

echo !NEWVERSION!>version.txt

echo.
echo Updating:
echo %VERSION% ^> !NEWVERSION!

git add .

git commit -m "%MSG% + Updated to !NEWVERSION!"

git push --force

for /f "delims=" %%A in ('git log -1 --pretty^=%%an') do set AUTHOR=%%A

curl -H "Content-Type: application/json" ^
-d "{\"embeds\":[{\"title\":\" New Commit Pushed\",\"description\":\"Version: !NEWVERSION!\",\"fields\":[{\"name\":\" Author\",\"value\":\"!AUTHOR!\",\"inline\":true},{\"name\":\" Repository\",\"value\":\"%REPO%\",\"inline\":true},{\"name\":\" Changed Files\",\"value\":\"```!FILES!```\"},{\"name\":\" Commit message\",\"value\":\"%MSG% + Updated to !NEWVERSION!\"}],\"footer\":{\"text\":\"GitHub Actions\"}}]}" ^
"%WEBHOOK%"
echo.
echo Finished!
pause