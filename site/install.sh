#!/usr/bin/env bash
set -euo pipefail

DURAR_VERSION="1.0.0"
DURAR_DIR="$HOME/.durar-ai"
INSTALL_DIR="$HOME/.durar-ai/app"
DOWNLOAD_BASE="https://yourdomain.com"
BIN_LINK="/usr/local/bin/durar-ai"
MIN_NODE_MAJOR=20

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}  →${RESET} $*"; }
success() { echo -e "${GREEN}  ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${RESET} $*"; }
error()   { echo -e "${RED}  ✗${RESET} $*" >&2; exit 1; }

trap 'error "Installation failed. See error above."' ERR

banner() {
  echo ""
  echo -e "${BOLD}  ✨  Durar AI Installer  v${DURAR_VERSION}${RESET}"
  echo -e "  ─────────────────────────────────────"
  echo ""
}

# ── OS detection ──────────────────────────────────────────────────────────────
detect_os() {
  OS="unknown"
  ARCH=$(uname -m)
  case "$ARCH" in x86_64) ARCH="x64" ;; arm64|aarch64) ARCH="arm64" ;; esac

  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"

    # Detect WSL
    if grep -qi microsoft /proc/version 2>/dev/null; then
      success "Running in WSL (good)"
    fi

    # Warn if not Ubuntu
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      if [[ "$ID" != "ubuntu" && "$ID_LIKE" != *"ubuntu"* ]]; then
        warn "Ubuntu is recommended for best compatibility"
      fi
    fi

  else
    error "Windows/macOS not supported directly.\nUse Ubuntu (WSL2 on Windows)."
  fi
}

# ── Install helpers ───────────────────────────────────────────────────────────
install_if_missing() {
  if ! command -v "$1" &>/dev/null; then
    info "$1 not found — installing..."
    sudo apt-get update -y
    sudo apt-get install -y "$2"
    success "$1 installed"
  else
    success "$1 already installed"
  fi
}

# ── Node.js ───────────────────────────────────────────────────────────────────
check_node() {
  if command -v node &>/dev/null; then
    CURRENT=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
    if [ "$CURRENT" -ge "$MIN_NODE_MAJOR" ]; then
      success "Node.js $(node -v) already installed"
      return
    else
      warn "Old Node.js detected — upgrading..."
    fi
  fi

  info "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs

  success "Node.js $(node -v) installed"
}

# ── Ollama ────────────────────────────────────────────────────────────────────
check_ollama() {
  if command -v ollama &>/dev/null; then
    success "Ollama already installed"
    return
  fi

  echo ""
  echo -e "  ${BOLD}Ollama${RESET} lets you run AI locally (recommended)\n"

  read -r -p "  Install Ollama now? [Y/n] " INSTALL_OLLAMA
  INSTALL_OLLAMA="${INSTALL_OLLAMA:-Y}"

  if [[ "$INSTALL_OLLAMA" =~ ^[Yy]$ ]]; then
    install_if_missing zstd zstd

    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh

    success "Ollama installed"

    if ! pgrep -x "ollama" > /dev/null; then
      info "Starting Ollama..."
      ollama serve &>/dev/null &
      sleep 2
      success "Ollama running"
    fi
  else
    warn "Skipping Ollama"
  fi
}

# ── Install Durar ─────────────────────────────────────────────────────────────
install_durar() {
  info "Downloading Durar AI v${DURAR_VERSION}..."

  mkdir -p "$INSTALL_DIR"
  TMPFILE=$(mktemp /tmp/durar-ai-XXXXXX.zip)

  curl -fsSL "${DOWNLOAD_BASE}/releases/durar-ai-node-${DURAR_VERSION}.zip" -o "$TMPFILE"

  info "Extracting..."
  install_if_missing unzip unzip

  unzip -q -o "$TMPFILE" -d /tmp/durar-ai-extract/
  rm -f "$TMPFILE"

  rm -rf "$INSTALL_DIR"
  mv /tmp/durar-ai-extract/* "$INSTALL_DIR" 2>/dev/null || true
  rm -rf /tmp/durar-ai-extract/

  info "Installing npm dependencies..."
  cd "$INSTALL_DIR"
  npm install --omit=dev --silent

  success "Durar AI installed"
}

# ── CLI setup ─────────────────────────────────────────────────────────────────
link_cli() {
  chmod +x "$INSTALL_DIR/src/cli.js"

  LAUNCHER="#!/usr/bin/env bash
node \"$INSTALL_DIR/src/cli.js\" \"\$@\""

  echo "$LAUNCHER" | sudo tee "$BIN_LINK" > /dev/null
  sudo chmod +x "$BIN_LINK"

  success "CLI ready: durar-ai"
}

# ── PATH ──────────────────────────────────────────────────────────────────────
setup_path() {
  RC="$HOME/.bashrc"
  PATH_LINE='export PATH="$HOME/.durar-ai/bin:$PATH"'

  if ! grep -q durar-ai "$RC" 2>/dev/null; then
    echo "$PATH_LINE" >> "$RC"
  fi
}

# ── Final ─────────────────────────────────────────────────────────────────────
done_msg() {
  echo ""
  echo -e "${GREEN}${BOLD}  ✨ Installed successfully!${RESET}"
  echo ""
  echo "  Run: durar-ai start"
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  banner
  detect_os

  install_if_missing curl curl
  install_if_missing unzip unzip

  check_node
  check_ollama
  install_durar
  link_cli
  setup_path
  done_msg
}

main