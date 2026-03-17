@echo off
chcp 65001 1>NUL 2>NUL
cd /d "%~dp0"
call :MAIN
echo.
echo  --- Press any key to close ---
pause
exit /b

:MAIN
:: -- Derive unique server title from folder name (supports parallel teams) --
for %%F in ("%~dp0.") do set "TEAM_FOLDER=%%~nxF"
set "SERVER_TITLE=AgentPortalServer_%TEAM_FOLDER%"
title Agent Team Portal - %TEAM_FOLDER%
echo.
echo  ===================================
echo    Agent Team Portal - %TEAM_FOLDER%
echo  ===================================
echo.

:: -- Ensure directories exist --
if not exist "config" mkdir config
if not exist "config\agent-templates" mkdir config\agent-templates
if not exist "profile" mkdir profile
if not exist "agents" mkdir agents
if not exist "data\tasks" mkdir data\tasks
if not exist "data\round-tables" mkdir data\round-tables
if not exist "data\media" mkdir data\media

:: -- Check Node.js --
echo  [1/3] Checking Node.js...
node --version 1>NUL 2>NUL
if errorlevel 1 goto NO_NODE
for /f "tokens=*" %%v in ('node --version') do echo        Node.js %%v - OK
goto CHECK_CLAUDE

:NO_NODE
echo        Node.js is NOT installed.
echo.
choice /m "        Install Node.js now"
if errorlevel 2 goto NODE_REQUIRED
echo        Opening Node.js download page...
start https://nodejs.org
echo        Install Node.js, then run this script again.
goto :EOF

:NODE_REQUIRED
echo        Node.js is required. Exiting.
goto :EOF

:: -- Check Claude CLI --
:CHECK_CLAUDE
echo  [2/3] Checking Claude CLI...
where claude 1>NUL 2>NUL
if errorlevel 1 goto NO_CLAUDE

for /f "tokens=*" %%v in ('claude --version') do (
    echo        Claude CLI %%v - OK
    set "CUR_VER=%%v"
)

echo        Checking for updates (contacting npm registry)...
for /f "tokens=*" %%v in ('npm view @anthropic-ai/claude-code version 2^>NUL') do set "LATEST_VER=%%v"
if not defined LATEST_VER (
    echo        Could not reach npm registry. Skipping update check.
    goto START_APP
)
echo %CUR_VER% | findstr /c:"%LATEST_VER%" 1>NUL 2>NUL
if not errorlevel 1 (
    echo        Already on latest version.
    goto START_APP
)
echo        Update available: %LATEST_VER%
choice /m "        Update Claude CLI now"
if errorlevel 2 goto START_APP
echo        Updating...
call npm install -g @anthropic-ai/claude-code@latest
echo        Done.
goto START_APP

:NO_CLAUDE
echo        Claude CLI is NOT installed.
echo.
choice /m "        Install Claude CLI now"
if errorlevel 2 (
    echo        Skipping. Dashboard will still launch but Command Center won't work.
    set "SKIP_CLAUDE=1"
    goto START_APP
)
echo        Installing (this may take a minute)...
call npm install -g @anthropic-ai/claude-code
where claude 1>NUL 2>NUL
if errorlevel 1 (
    echo        Installation failed. Dashboard will still launch.
    set "SKIP_CLAUDE=1"
) else (
    echo        Claude CLI installed successfully.
)

:: -- Install dependencies --
:INSTALL_DEPS
echo  [3/3] Installing dependencies...
if not exist "node_modules" (call npm install --production) else (echo        OK)

:: -- Launch --
:START_APP
echo.
echo  -----------------------------------
echo    Starting up...
echo  -----------------------------------
echo.

echo  Starting portal server...
start "%SERVER_TITLE%" /b node server.js
timeout /t 3 /noq 1>NUL

:: Read port from config/system.json
set "PORTAL_PORT=3777"
for /f "tokens=2 delims=:, " %%a in ('findstr /c:"\"port\"" config\system.json 2^>NUL') do set "PORTAL_PORT=%%a"

echo  Opening portal in browser...
start "" http://localhost:%PORTAL_PORT%

echo.
echo  Portal: http://localhost:%PORTAL_PORT%
echo  Claude is available in the portal's Command Center.
echo.

if defined SKIP_CLAUDE (
    echo  Claude CLI not installed. Command Center won't work until installed.
)

echo  Press any key to stop the server and exit...
pause 1>NUL

:CLEANUP
taskkill /f /fi "WINDOWTITLE eq %SERVER_TITLE%" 1>NUL 2>NUL
goto :EOF
