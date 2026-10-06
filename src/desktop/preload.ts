import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ultimateTv", {
  systemInfo: () => ipcRenderer.invoke("system:info"),
  avds: () => ipcRenderer.invoke("session:avds"),
  status: () => ipcRenderer.invoke("session:status"),
  start: (options: { avd: string; deviceName?: string; coldBoot?: boolean }) =>
    ipcRenderer.invoke("session:start", options),
  stop: () => ipcRenderer.invoke("session:stop"),
  openDocs: () => ipcRenderer.invoke("system:open-docs"),
  onStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) =>
      callback(status);
    ipcRenderer.on("session:status", listener);
    return () => ipcRenderer.removeListener("session:status", listener);
  },
});
