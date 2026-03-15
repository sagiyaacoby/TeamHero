#!/usr/bin/env bash
cd "$(dirname "$0")"

echo ""
echo "  ==================================="
echo "    Agent Team Portal"
echo "  ==================================="
echo ""

ask_yn() {
    local prompt="$1"
    local answer
    read -r -p "        $prompt (Y/N): " answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

# ── Step 1: Check Node.js ──
echo "  [1/3] Checking Node.js..."
if ! command -v node &>/dev/null; then
    echo "        Node.js is NOT installed."
    echo ""
    if ask_yn "Install Node.js now?"; then
        if command -v brew &>/dev/null; then
            echo "        Installing via Homebrew..."
            brew install node
        elif command -v apt-get &>/dev/null; then
            echo "        Installing via apt..."
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif command -v dnf &>/dev/null; then
            echo "        Installing via dnf..."
            sudo dnf install -y nodejs
        elif command -v pacman &>/dev/null; then
            echo "        Installing via pacman..."
            sudo pacman -S --noconfirm nodejs npm
        else
            echo "        No supported package manager found."
            echo "        Please install Node.js from https://nodejs.org"
            exit 1
        fi
        if ! command -v node &>/dev/null; then
            echo "        Installation failed. Please install manually."
            exit 1
        fi
        echo "        Node.js installed successfully."
    else
        echo "        Node.js is required. Exiting."
        exit 1
    fi
else
    echo "        Node.js $(node --version) found."
fi

# ── Step 2: Check npm ──
echo "  [2/3] Checking npm..."
if ! command -v npm &>/dev/null; then
    echo "        npm not found. It should come with Node.js."
    echo "        Please reinstall Node.js from https://nodejs.org"
    exit 1
else
    echo "        npm $(npm --version) found."
fi

# ── Step 3: Check Claude CLI ──
SKIP_CLAUDE=0
echo "  [3/3] Checking Claude CLI..."
if ! command -v claude &>/dev/null; then
    echo "        Claude CLI is NOT installed."
    echo ""
    if ask_yn "Install Claude CLI now?"; then
        echo "        Installing @anthropic-ai/claude-code..."
        npm install -g @anthropic-ai/claude-code
        if ! command -v claude &>/dev/null; then
            echo "        Installation failed. Try: npm install -g @anthropic-ai/claude-code"
            SKIP_CLAUDE=1
        else
            echo "        Claude CLI installed successfully."
        fi
    else
        echo "        Skipping Claude CLI. Command Center won't work until installed."
        SKIP_CLAUDE=1
    fi
else
    CUR_VER=$(claude --version 2>/dev/null)
    echo "        Claude CLI ${CUR_VER} found."

    # Check for updates
    echo "        Checking for updates..."
    LATEST_VER=$(npm view @anthropic-ai/claude-code version 2>/dev/null || echo "")
    if [[ -n "$LATEST_VER" ]]; then
        if echo "$CUR_VER" | grep -q "$LATEST_VER"; then
            echo "        Already on latest version."
        else
            echo "        Update available: ${LATEST_VER} (current: ${CUR_VER})"
            if ask_yn "Update Claude CLI now?"; then
                echo "        Updating..."
                npm install -g @anthropic-ai/claude-code@latest && echo "        Updated successfully." || echo "        Update failed. Continuing with current version."
            fi
        fi
    else
        echo "        Could not check for updates (offline?). Continuing."
    fi
fi

echo ""
echo "  ───────────────────────────────────"
echo "    All checks passed!"
echo "  ───────────────────────────────────"
echo ""

# ── Start dashboard server ──
echo "  Starting dashboard server..."
node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

sleep 2

echo "  Opening dashboard in browser..."
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:3777 &>/dev/null
elif command -v open &>/dev/null; then
    open http://localhost:3777
else
    echo "  Open http://localhost:3777 in your browser."
fi

echo ""
echo "  Portal: http://localhost:3777"
echo "  Claude is available in the portal's Command Center."
echo ""

if [[ "$SKIP_CLAUDE" -eq 1 ]]; then
    echo "  Claude CLI not installed. Command Center won't work until installed."
fi

echo "  Press Enter to stop the server and exit..."
read
