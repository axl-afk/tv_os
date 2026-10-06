$ErrorActionPreference = "Stop"

Write-Host "Ultimate TV OS - Windows bootstrap"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js 22+ is required."
}

$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) {
  throw "Node.js 22+ is required. Found $(node -v)."
}

if ($env:ANDROID_SDK_ROOT) {
  $sdkRoot = $env:ANDROID_SDK_ROOT
} elseif ($env:ANDROID_HOME) {
  $sdkRoot = $env:ANDROID_HOME
} else {
  $sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

$adb = Join-Path $sdkRoot "platform-tools\adb.exe"
$emulator = Join-Path $sdkRoot "emulator\emulator.exe"

if (-not (Test-Path $adb) -or -not (Test-Path $emulator)) {
  Write-Host ""
  Write-Host "Android SDK tooling was not found at:"
  Write-Host "  $sdkRoot"
  Write-Host ""
  Write-Host "Install Android Studio and make sure these are installed:"
  Write-Host "  - Android SDK Platform-Tools"
  Write-Host "  - Android Emulator"
  Write-Host "  - a Google TV / Android TV system image"
  exit 1
}

npm install
npm run typecheck
npm test
npm run build

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Run: npm run desktop"
