import { run } from "../lib/process.js";

export type FullscreenResult = {
  ok: boolean;
  message: string;
};

function macFullscreen(avd: string): FullscreenResult {
  const escapedAvd = avd.replace(/"/g, '\\"');
  const script = \`
tell application "System Events"
  set candidates to every application process whose visible is true
  repeat with p in candidates
    set n to name of p
    try
      set wt to name of front window of p
    on error
      set wt to ""
    end try
    if n contains "qemu-system" or n contains "emulator" or wt contains "\${escapedAvd}" then
      try
        set frontmost of p to true
        delay 0.25
        keystroke "f" using {control down, command down}
        return "ok"
      end try
    end if
  end repeat
end tell
return "not-found"
\`;

  const result = run("/usr/bin/osascript", ["-e", script]);
  if (result.ok && result.stdout.trim() === "ok") {
    return { ok: true, message: "Android TV entered macOS fullscreen mode." };
  }

  return {
    ok: false,
    message:
      "Could not toggle emulator fullscreen automatically. macOS may require Accessibility permission for Ultimate TV OS.",
  };
}

function windowsFullscreen(avd: string): FullscreenResult {
  const safeAvd = avd.replace(/'/g, "''");
  const script = \`
$wshell = New-Object -ComObject WScript.Shell
$target = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and (
    $_.MainWindowTitle -like '*\${safeAvd}*' -or
    $_.MainWindowTitle -like '*Android Emulator*'
  )
} | Select-Object -First 1
if ($target -and $wshell.AppActivate($target.Id)) {
  Start-Sleep -Milliseconds 250
  $wshell.SendKeys('%{ENTER}')
  Write-Output 'ok'
  exit 0
}
Write-Output 'not-found'
exit 0
\`;

  const result = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script,
  ]);

  if (result.ok && result.stdout.includes("ok")) {
    return { ok: true, message: "Android TV fullscreen requested on Windows." };
  }
  return {
    ok: false,
    message: "Could not toggle emulator fullscreen automatically on Windows.",
  };
}

function linuxFullscreen(avd: string): FullscreenResult {
  const safeAvd = avd.replace(/'/g, "'\\''");
  const command = \`
if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -r '\${safeAvd}' -b add,fullscreen 2>/dev/null || wmctrl -r 'Android Emulator' -b add,fullscreen 2>/dev/null
elif command -v xdotool >/dev/null 2>&1; then
  id=$(xdotool search --name '\${safeAvd}' 2>/dev/null | head -n1)
  [ -n "$id" ] && xdotool windowactivate "$id" key alt+Return
else
  exit 2
fi
\`;
  const result = run("/bin/sh", ["-lc", command]);
  if (result.ok) {
    return { ok: true, message: "Android TV fullscreen requested on Linux." };
  }
  return {
    ok: false,
    message: "Install wmctrl (recommended) or xdotool for automatic Linux fullscreen.",
  };
}

export function requestEmulatorFullscreen(avd: string): FullscreenResult {
  if (process.platform === "darwin") return macFullscreen(avd);
  if (process.platform === "win32") return windowsFullscreen(avd);
  if (process.platform === "linux") return linuxFullscreen(avd);
  return { ok: false, message: "Automatic fullscreen is unsupported on this host OS." };
}
