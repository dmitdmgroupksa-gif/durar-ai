#Requires -Version 5.1
<#
.SYNOPSIS
    Durar AI Windows Installer
.DESCRIPTION
    Installs Durar AI CLI tool on Windows 10/11.
    Requires PowerShell 5.1+ (included with Windows).
.NOTES
    If blocked by execution policy, run:
      Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuration ─────────────────────────────────────────────────────────────
$INSTALL_DIR     = Join-Path $env:USERPROFILE ".durar-ai"
$APP_DIR         = Join-Path $INSTALL_DIR "app"
$BIN_DIR         = Join-Path $INSTALL_DIR "bin"
$DOWNLOAD_BASE   = "https://durar.ai"
$MIN_NODE_MAJOR  = 20
$NODE_VERSION    = "20.18.1"          # LTS — bump as needed
$NODE_ARCH       = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$NODE_INSTALLER  = "node-v$NODE_VERSION-$NODE_ARCH.msi"
$NODE_URL        = "https://nodejs.org/dist/v$NODE_VERSION/$NODE_INSTALLER"

# ── Fetch version from server ─────────────────────────────────────────────────
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $versionJson = (Invoke-WebRequest -Uri "$DOWNLOAD_BASE/version" -UseBasicParsing -TimeoutSec 5).Content
    $DURAR_VERSION = ($versionJson | ConvertFrom-Json).version
} catch {
    $DURAR_VERSION = "latest"
}

# ── Colours ───────────────────────────────────────────────────────────────────
function Write-Info    { param($m) Write-Host "  → " -NoNewline -ForegroundColor Cyan;    Write-Host $m }
function Write-Ok      { param($m) Write-Host "  ✓ " -NoNewline -ForegroundColor Green;   Write-Host $m }
function Write-Warn    { param($m) Write-Host "  ⚠ " -NoNewline -ForegroundColor Yellow;  Write-Host $m }
function Write-Err     { param($m) Write-Host "  ✗ " -NoNewline -ForegroundColor Red;     Write-Host $m }
function Write-Banner  {
    Write-Host ""
    Write-Host "  Durar AI Installer  v$DURAR_VERSION" -ForegroundColor White -Bold
    Write-Host "  ─────────────────────────────────────"
    Write-Host ""
}

# ── Execution Policy Check ────────────────────────────────────────────────────
function Test-ExecutionPolicy {
    $policy = (Get-ExecutionPolicy -Scope CurrentUser).ToString()
    if ($policy -eq "Restricted") {
        Write-Host ""
        Write-Host "  Your PowerShell execution policy is set to Restricted." -ForegroundColor Yellow
        Write-Host "  This script cannot run until you allow local scripts." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Run this command in a new PowerShell window:" -ForegroundColor White
        Write-Host ""
        Write-Host "    Set-ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Then run this installer again." -ForegroundColor White
        Write-Host ""
        exit 1
    }
}

# ── Node.js ───────────────────────────────────────────────────────────────────
function Test-NodeJs {
    try {
        $node = Get-Command node -ErrorAction Stop
        $version = & node -v
        $major   = [int]($version -replace '[^0-9]', '').Substring(0, 2)
        if ($major -ge $MIN_NODE_MAJOR) {
            Write-Ok "Node.js $version already installed"
            return $true
        }
        Write-Warn "Old Node.js ($version) — upgrading to v$NODE_VERSION..."
    } catch {
        Write-Info "Node.js not found"
    }
    return $false
}

function Install-NodeJs {
    Write-Info "Downloading Node.js $NODE_VERSION ($NODE_ARCH)..."
    $msiPath = Join-Path $env:TEMP $NODE_INSTALLER

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $NODE_URL -OutFile $msiPath -UseBasicParsing
    } catch {
        Write-Err "Failed to download Node.js installer."
        Write-Host ""
        Write-Host "  Please download it manually from:" -ForegroundColor White
        Write-Host "    https://nodejs.org" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  Install it, then run this script again." -ForegroundColor White
        Write-Host ""
        exit 1
    }

    Write-Info "Installing Node.js (this may take a minute)..."
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /quiet /norestart" -Wait -PassThru -NoNewWindow
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

    if ($proc.ExitCode -ne 0) {
        Write-Err "Node.js installation failed (exit code $($proc.ExitCode))."
        exit 1
    }

    # Refresh PATH in current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    Write-Ok "Node.js $(& node -v) installed"
}

# ── Download & Extract Durar AI ───────────────────────────────────────────────
function Install-Durar {
    $zipName = "durar-ai-node-$DURAR_VERSION.zip"
    $zipUrl  = "$DOWNLOAD_BASE/releases/$zipName"
    $zipPath = Join-Path $env:TEMP $zipName

    # Clean previous install
    if (Test-Path $APP_DIR) {
        Write-Info "Removing previous install..."
        Remove-Item $APP_DIR -Recurse -Force
    }

    Write-Info "Downloading Durar AI v$DURAR_VERSION..."
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    } catch {
        Write-Err "Failed to download Durar AI."
        Write-Host "  URL: $zipUrl" -ForegroundColor Gray
        Write-Host "  Error: $_" -ForegroundColor Gray
        exit 1
    }

    Write-Info "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $APP_DIR -Force
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

    # If ZIP extracted into a subfolder, flatten it
    $items = Get-ChildItem $APP_DIR -Force
    if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
        $subDir = $items[0].FullName
        Get-ChildItem $subDir -Force | Move-Item -Destination $APP_DIR -Force
        Remove-Item $subDir -Recurse -Force
    }

    Write-Info "Installing npm dependencies..."
    Push-Location $APP_DIR
    try {
        & npm install --omit=dev --silent 2>&1 | Out-Null
    } catch {
        Write-Warn "npm install had warnings (non-fatal)"
    }
    Pop-Location

    Write-Ok "Durar AI v$DURAR_VERSION installed"
}

# ── CLI Setup ─────────────────────────────────────────────────────────────────
function Setup-Cli {
    if (-not (Test-Path $BIN_DIR)) {
        New-Item -ItemType Directory -Path $BIN_DIR -Force | Out-Null
    }

    # Write durar-ai.cmd
    $cmdPath = Join-Path $BIN_DIR "durar-ai.cmd"
    $cliPath = Join-Path $APP_DIR "src" "cli.js"
    $cmdContent = @"
@echo off
node "$cliPath" %*
"@
    Set-Content -Path $cmdPath -Value $cmdContent -Encoding ASCII

    # Add bin dir to user PATH (persistent)
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$BIN_DIR*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$BIN_DIR", "User")
        # Also update current session
        $env:Path += ";$BIN_DIR"
        Write-Ok "Added $BIN_DIR to PATH"
    } else {
        Write-Ok "PATH already configured"
    }

    Write-Ok "CLI ready: durar-ai"
}

# ── Ollama (optional) ─────────────────────────────────────────────────────────
function Install-Ollama {
    Write-Host ""
    Write-Host "  Ollama lets you run AI models locally (recommended)" -ForegroundColor White
    Write-Host ""
    $answer = Read-Host "  Install Ollama now? [Y/n]"
    if ([string]::IsNullOrWhiteSpace($answer) -or $answer -match '^[Yy]') {
        Write-Info "Downloading Ollama for Windows..."
        $ollamaInstaller = Join-Path $env:TEMP "OllamaSetup.exe"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $ollamaInstaller -UseBasicParsing
        } catch {
            Write-Warn "Could not download Ollama — you can install it later from https://ollama.com"
            return
        }
        Write-Info "Launching Ollama installer..."
        Start-Process $ollamaInstaller -Wait
        Remove-Item $ollamaInstaller -Force -ErrorAction SilentlyContinue
        Write-Ok "Ollama installed"
    } else {
        Write-Warn "Skipping Ollama — you can install it later from https://ollama.com"
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────
function Main {
    Write-Banner
    Test-ExecutionPolicy

    if (-not (Test-NodeJs)) {
        Install-NodeJs
    }

    Install-Ollama
    Install-Durar
    Setup-Cli

    Write-Host ""
    Write-Host "  Installed successfully!" -ForegroundColor Green -Bold
    Write-Host ""

    # Refresh PATH in current session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    Write-Host "  Launching setup wizard..." -ForegroundColor White
    Write-Host ""

    # Run setup wizard
    Push-Location $APP_DIR
    try {
        & node "src\setup.js"
    } catch {
        Write-Warn "Setup wizard failed — run 'durar-ai setup' manually later"
    }
    Pop-Location

    Write-Host ""
    Write-Host "  Done! To start the gateway:" -ForegroundColor Green -Bold
    Write-Host ""
    Write-Host "    durar-ai start" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Press Enter to close this window..." -ForegroundColor Gray
    Read-Host
}

Main
