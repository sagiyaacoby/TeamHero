@echo off
chcp 65001 1>NUL 2>NUL
cd /d "%~dp0"
call :MAIN
echo.
echo  --- Press any key to close ---
pause
exit /b

:MAIN
title Agent Team Portal
echo.
echo  ===================================
echo    Agent Team Portal
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
echo  [1/2] Checking Node.js...
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
echo  [2/2] Checking Claude CLI...
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

:: -- Launch --
:START_APP
echo.
echo  -----------------------------------
echo    Starting up...
echo  -----------------------------------
echo.

echo  Starting portal server...
start "AgentPortalServer" /b node server.js
timeout /t 2 /noq 1>NUL

echo  Opening portal in browser...
start "" http://localhost:3777

echo.
echo  Portal: http://localhost:3777
echo  Claude is available in the portal's Command Center.
echo.

if defined SKIP_CLAUDE (
    echo  Claude CLI not installed. Command Center won't work until installed.
)

echo  Press any key to stop the server and exit...
pause 1>NUL

:CLEANUP
taskkill /f /fi "WINDOWTITLE eq AgentPortalServer" 1>NUL 2>NUL
goto :EOF
