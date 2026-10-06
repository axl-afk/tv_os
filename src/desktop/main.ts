import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { UltimateTvSession } from "../core/session.js";
import { detectAndroidTools, listAvds } from "../android/sdk.js";
import { runDoctorSnapshot } from "../doctor.js";
import { RuntimeInstaller } from "../runtime/installer.js";

const session = new UltimateTvSession();
const runtime = new RuntimeInstaller();
let mainWindow: BrowserWindow | null = null;

function rendererPath() {
  return path.join(app.getAppPath(), "desktop", "renderer.html");
}

function send(channel: string, payload: unknown) {
  mainWindow?.webContents.send(channel, payload);
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
      preload: path.join(app.getAppPath(), "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(rendererPath());

  session.on("status", (status) => send("session:status", status));
  runtime.on("status", (status) => send("runtime:status", status));
}

app.whenReady().then(() => {
  ipcMain.handle("system:info", () => {
    const tools = detectAndroidTools();
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
  ipcMain.handle("runtime:remove", async () => runtime.remove());

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
        fullscreen?: boolean;
        remoteMode?: "auto" | "native" | "compatibility";
      },
    ) => session.start(options),
  );
  ipcMain.handle("session:stop", async () => session.stop());

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

app.on("before-quit", () => {
  void session.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
