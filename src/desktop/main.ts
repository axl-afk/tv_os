import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UltimateTvSession } from "../core/session.js";
import { detectAndroidTools, listAvds } from "../android/sdk.js";
import { runDoctorSnapshot } from "../doctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const session = new UltimateTvSession();
let mainWindow: BrowserWindow | null = null;

function rendererPath() {
  return path.join(app.getAppPath(), "desktop", "renderer.html");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#090d16",
    title: "Ultimate TV OS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(rendererPath());

  session.on("status", (status) => {
    mainWindow?.webContents.send("session:status", status);
  });
}

app.whenReady().then(() => {
  ipcMain.handle("system:info", () => {
    const tools = detectAndroidTools();
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      sdkRoot: tools.sdkRoot,
      adb: Boolean(tools.adb),
      emulator: Boolean(tools.emulator),
      avds: tools.emulator ? listAvds(tools.emulator) : [],
      doctor: runDoctorSnapshot(),
    };
  });

  ipcMain.handle("session:status", () => session.status());
  ipcMain.handle("session:avds", () => session.availableAvds());
  ipcMain.handle(
    "session:start",
    async (_event, options: { avd: string; deviceName?: string; coldBoot?: boolean }) =>
      session.start(options),
  );
  ipcMain.handle("session:stop", async () => session.stop());

  ipcMain.handle("system:open-docs", async () => {
    await shell.openExternal("https://github.com/axl-afk/tv_os");
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
