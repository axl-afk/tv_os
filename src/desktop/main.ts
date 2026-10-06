import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  type Display,
} from "electron";
import path from "node:path";
import { UltimateTvSession, type SessionSnapshot } from "../core/session.js";
import { detectAndroidTools, listAvds } from "../android/sdk.js";
import { AdbInput } from "../android/adbInput.js";
import { runDoctorSnapshot } from "../doctor.js";
import { RuntimeInstaller } from "../runtime/installer.js";
import {
  EmulatorDisplayStream,
  type TvFrame,
} from "../emulator/grpcDisplay.js";
import { waitForEmulatorGrpcEndpoint } from "../emulator/discovery.js";

const session = new UltimateTvSession();
const runtime = new RuntimeInstaller();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tvWindow: BrowserWindow | null = null;
let displayStream: EmulatorDisplayStream | null = null;
let tvInput: AdbInput | null = null;
let tvGuestSize = { width: 1920, height: 1080 };
let tvFrameInFlight = false;
let pendingTvFrame: TvFrame | null = null;
let closingTvSurface = false;
let quitCleanupInProgress = false;
let quitCleanupComplete = false;

function rendererPath(file = "renderer.html") {
  return path.join(app.getAppPath(), "desktop", file);
}

function sendMain(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendTv(channel: string, payload: unknown) {
  if (tvWindow && !tvWindow.isDestroyed()) {
    tvWindow.webContents.send(channel, payload);
  }
}

function displaySummary(display: Display, primaryId: number) {
  return {
    id: String(display.id),
    label: display.label || `Display ${display.id}`,
    primary: display.id === primaryId,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 860,
    minHeight: 680,
    backgroundColor: "#090d16",
    title: "Ultimate TV OS",
    webPreferences: {
      preload: rendererPath("preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(rendererPath());

  session.on("status", (status) => {
    sendMain("session:status", status);
    sendTv("tv:status", { message: status.message });
  });

  runtime.on("status", (status) => sendMain("runtime:status", status));
}

async function stopDisplayStream() {
  displayStream?.stop();
  displayStream = null;
  tvInput = null;
  tvGuestSize = { width: 1920, height: 1080 };
  tvFrameInFlight = false;
  pendingTvFrame = null;
}

async function closeTvSurface() {
  await stopDisplayStream();

  if (tvWindow && !tvWindow.isDestroyed()) {
    closingTvSurface = true;
    const windowToClose = tvWindow;
    tvWindow = null;
    windowToClose.removeAllListeners("closed");
    windowToClose.destroy();
    closingTvSurface = false;
  } else {
    tvWindow = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function stopTvCompletely() {
  await closeTvSurface();
  return session.stop();
}

async function createTvSurface(
  snapshot: SessionSnapshot,
  requestedDisplayId?: string,
  startFullscreen = false,
) {
  if (!snapshot.grpcPort || !snapshot.serial) {
    throw new Error(
      "Embedded TV session did not provide a display endpoint.",
    );
  }

  await closeTvSurface();

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target =
    displays.find((display) => String(display.id) === requestedDisplayId) ??
    primary;

  const workArea = target.workArea;
  const windowWidth = Math.min(1280, workArea.width);
  const windowHeight = Math.min(720, workArea.height);
  const windowX =
    workArea.x + Math.max(0, Math.floor((workArea.width - windowWidth) / 2));
  const windowY =
    workArea.y + Math.max(0, Math.floor((workArea.height - windowHeight) / 2));

  tvWindow = new BrowserWindow({
    x: windowX,
    y: windowY,
    width: windowWidth,
    height: windowHeight,
    minWidth: 720,
    minHeight: 405,
    frame: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    fullscreen: false,
    kiosk: false,
    fullscreenable: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    backgroundColor: "#000000",
    show: false,
    autoHideMenuBar: true,
    title: "Ultimate TV",
    webPreferences: {
      preload: rendererPath("tv-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  tvWindow.setMenuBarVisibility(false);
  if (process.platform === "darwin") {
    tvWindow.setWindowButtonVisibility(true);
  }

  const sendWindowState = () => {
    if (!tvWindow || tvWindow.isDestroyed()) return;
    sendTv("tv:window-state", {
      fullscreen: tvWindow.isFullScreen(),
      maximized: tvWindow.isMaximized(),
      minimized: tvWindow.isMinimized(),
    });
  };

  tvWindow.on("enter-full-screen", sendWindowState);
  tvWindow.on("leave-full-screen", sendWindowState);
  tvWindow.on("maximize", sendWindowState);
  tvWindow.on("unmaximize", sendWindowState);
  tvWindow.on("minimize", sendWindowState);
  tvWindow.on("restore", sendWindowState);

  tvWindow.on("closed", () => {
    tvWindow = null;
    void stopDisplayStream();

    if (!closingTvSurface) {
      void session.stop();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  await tvWindow.loadFile(rendererPath("tv.html"));

  const tools = detectAndroidTools();
  if (!tools.adb) {
    throw new Error("Ultimate TV ADB runtime disappeared after boot.");
  }

  tvInput = new AdbInput(tools.adb, snapshot.serial);
  tvGuestSize = {
    width: snapshot.displayWidth ?? 1920,
    height: snapshot.displayHeight ?? 1080,
  };

  const endpoint = await waitForEmulatorGrpcEndpoint(
    snapshot.serial,
    20_000,
  );

  const physicalWidth = Math.max(
    1,
    Math.round(target.size.width * target.scaleFactor),
  );
  const physicalHeight = Math.max(
    1,
    Math.round(target.size.height * target.scaleFactor),
  );
  const streamWidth = Math.min(
    snapshot.displayWidth ?? physicalWidth,
    physicalWidth,
  );
  const streamHeight = Math.min(
    snapshot.displayHeight ?? physicalHeight,
    physicalHeight,
  );

  displayStream = new EmulatorDisplayStream({
    port: endpoint.port,
    address: endpoint.address,
    token: endpoint.token,
    appPath: app.getAppPath(),
    width: streamWidth,
    height: streamHeight,
    maxFps: 60,
  });

  const sendFrame = (frame: TvFrame) => {
    if (!tvWindow || tvWindow.isDestroyed()) return;

    if (tvFrameInFlight) {
      pendingTvFrame = frame;
      return;
    }

    tvFrameInFlight = true;
    sendTv("tv:frame", {
      pixels: frame.pixels,
      format: frame.format,
      width: frame.width,
      height: frame.height,
      sequence: frame.sequence,
      timestampUs: frame.timestampUs,
    });
  };

  displayStream.on("frame", sendFrame);

  displayStream.on("error", (error) => {
    sendTv("tv:status", {
      error: "TV display stream error: " + String(error),
    });
  });

  await displayStream.start();

  tvWindow.show();
  tvWindow.focus();

  if (startFullscreen) {
    tvWindow.setFullScreen(true);
  }

  sendWindowState();
}

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  ipcMain.handle("system:info", () => {
    const tools = detectAndroidTools();
    const primaryId = screen.getPrimaryDisplay().id;

    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      sdkRoot: tools.sdkRoot,
      sdkSource: tools.source,
      adb: Boolean(tools.adb),
      emulator: Boolean(tools.emulator),
      avds: tools.emulator
        ? listAvds(tools.emulator, tools.environment)
        : [],
      displays: screen
        .getAllDisplays()
        .map((display) => displaySummary(display, primaryId)),
      doctor: runDoctorSnapshot(),
      runtime: runtime.status(),
    };
  });

  ipcMain.handle("runtime:status", () => runtime.status());
  ipcMain.handle(
    "runtime:install",
    async (_event, options: { licenseAccepted: boolean }) =>
      runtime.install(Boolean(options?.licenseAccepted)),
  );
  ipcMain.handle("runtime:remove", async () => {
    const state = session.status().state;
    if (state !== "idle" && state !== "error") {
      throw new Error("Stop Ultimate TV before resetting the runtime.");
    }
    return runtime.remove();
  });

  ipcMain.handle("session:status", () => session.status());
  ipcMain.handle("session:avds", () => session.availableAvds());

  ipcMain.handle(
    "session:start",
    async (
      _event,
      options: {
        avd: string;
        deviceName?: string;
        coldBoot?: boolean;
        displayId?: string;
        displayMode?: "native" | "embedded";
        fullscreen?: boolean;
        remoteMode?: "off" | "auto" | "native" | "compatibility";
      },
    ) => {
      try {
        const snapshot = await session.start({
          avd: options.avd,
          deviceName: options.deviceName,
          coldBoot: options.coldBoot,
          embedded: true,
          fullscreen: Boolean(options.fullscreen),
          remoteMode: options.remoteMode,
        });

        await createTvSurface(
          snapshot,
          options.displayId,
          Boolean(options.fullscreen),
        );
        return snapshot;
      } catch (error) {
        await stopTvCompletely();
        throw error;
      }
    },
  );

  ipcMain.handle("session:stop", async () => stopTvCompletely());

  ipcMain.on("tv:key", (_event, keyCode: number) => {
    if (!tvInput || !Number.isFinite(keyCode)) return;
    try {
      tvInput.key(Number(keyCode));
    } catch (error) {
      sendTv("tv:status", { error: String(error) });
    }
  });

  ipcMain.on("tv:frame-consumed", () => {
    tvFrameInFlight = false;

    if (pendingTvFrame) {
      const next = pendingTvFrame;
      pendingTvFrame = null;

      if (tvWindow && !tvWindow.isDestroyed()) {
        tvFrameInFlight = true;
        sendTv("tv:frame", {
          pixels: next.pixels,
          format: next.format,
          width: next.width,
          height: next.height,
          sequence: next.sequence,
          timestampUs: next.timestampUs,
        });
      }
    }
  });

  ipcMain.on("tv:text", (_event, value: string) => {
    if (!tvInput || typeof value !== "string" || !value) return;
    try {
      tvInput.text(value);
    } catch (error) {
      sendTv("tv:status", { error: String(error) });
    }
  });

  ipcMain.on(
    "tv:tap",
    (_event, point: { x?: number; y?: number }) => {
      if (!tvInput) return;

      const x = Math.min(1, Math.max(0, Number(point?.x ?? 0)));
      const y = Math.min(1, Math.max(0, Number(point?.y ?? 0)));

      try {
        tvInput.tap(
          x * tvGuestSize.width,
          y * tvGuestSize.height,
        );
      } catch (error) {
        sendTv("tv:status", { error: String(error) });
      }
    },
  );

  ipcMain.handle("tv:exit", async () => stopTvCompletely());

  ipcMain.handle("system:open-docs", async () => {
    await shell.openExternal("https://github.com/axl-afk/tv_os");
  });

  ipcMain.handle("system:open-android-license", async () => {
    await shell.openExternal("https://developer.android.com/studio/terms");
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  if (quitCleanupComplete) return;

  const state = session.status().state;
  const needsCleanup =
    state !== "idle" ||
    Boolean(displayStream) ||
    Boolean(tvWindow && !tvWindow.isDestroyed());

  if (!needsCleanup) {
    quitCleanupComplete = true;
    return;
  }

  event.preventDefault();
  if (quitCleanupInProgress) return;
  quitCleanupInProgress = true;

  void stopTvCompletely()
    .catch((error) => {
      console.error("Ultimate TV shutdown cleanup failed:", error);
    })
    .finally(() => {
      quitCleanupComplete = true;
      quitCleanupInProgress = false;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
