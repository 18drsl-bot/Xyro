@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "REMOTE=main"
set "BRANCH=main"
set "REPO=vertxxy-1/Xyro"

rem Prefer the configured "main" remote, but fall back to origin.
git remote get-url !REMOTE! >nul 2>&1
if errorlevel 1 set "REMOTE=origin"

rem Push the currently checked-out branch when possible.
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if defined CURRENT_BRANCH set "BRANCH=!CURRENT_BRANCH!"
set "WEBHOOK="

echo.
echo Enter commit message:
set /p "MSG="

if not defined MSG (
    echo.
    echo No message entered.
    pause
    exit /b 1
)

set "FILES="

for /f "delims=" %%A in ('git diff --name-only') do (
    set "FILES=!FILES!%%A\n"
)

if not defined FILES (
    set "FILES=No changed files"
)

if not exist version.txt (
    echo v0.0.0>version.txt
)

set /p "VERSION="<version.txt
set "VER=!VERSION:v=!"

for /f "tokens=1,2,3 delims=." %%a in ("!VER!") do (
    set "MAJOR=%%a"
    set "MINOR=%%b"
    set "PATCH=%%c"
)

set /a PATCH+=1

if !PATCH! GEQ 10 (
    set "PATCH=0"
    set /a MINOR+=1
)

if !MINOR! GEQ 10 (
    set "MINOR=0"
    set /a MAJOR+=1
)

set "NEWVERSION=v!MAJOR!.!MINOR!.!PATCH!"

echo !NEWVERSION!>version.txt

echo.
echo Updating:
echo !VERSION! ^> !NEWVERSION!
echo.

git add .

git commit -m "!MSG! + Updated to !NEWVERSION!"

if errorlevel 1 (
    echo.
    echo ERROR: Commit failed.
    pause
    exit /b 1
)

echo.
echo Pushing to GitHub...

git push -u !REMOTE! !BRANCH!

if errorlevel 1 (
    echo.
    echo ERROR: Push failed.
    pause
    exit /b 1
)

echo.
echo GitHub push successful.

if defined WEBHOOK (
    for /f "delims=" %%A in ('git log -1 --pretty=%%an') do (
        set "AUTHOR=%%A"
    )

    curl -sS ^
    -H "Content-Type: application/json" ^
    -d "{\"embeds\":[{\"title\":\"New Commit Pushed\",\"description\":\"Version: !NEWVERSION!\",\"fields\":[{\"name\":\"Author\",\"value\":\"!AUTHOR!\",\"inline\":true},{\"name\":\"Repository\",\"value\":\"!REPO!\",\"inline\":true},{\"name\":\"Changed Files\",\"value\":\"```!FILES!```\"},{\"name\":\"Commit message\",\"value\":\"!MSG! + Updated to !NEWVERSION!\"}],\"footer\":{\"text\":\"Xyro Update Script\"}}]}" ^
    "!WEBHOOK!"

    if errorlevel 1 (
        echo.
        echo WARNING: Discord notification failed.
    ) else (
        echo Discord notification sent.
    )
) else (
    echo Discord webhook disabled.
)

echo.
echo Finished!
echo Version: !NEWVERSION!
echo Branch: !BRANCH!
echo Repo: !REPO!
echo.

pause