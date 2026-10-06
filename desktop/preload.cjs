const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ultimateTv", {
  systemInfo: () => ipcRenderer.invoke("system:info"),
  avds: () => ipcRenderer.invoke("session:avds"),
  status: () => ipcRenderer.invoke("session:status"),
  start: (options) => ipcRenderer.invoke("session:start", options),
  stop: () => ipcRenderer.invoke("session:stop"),
  openDocs: () => ipcRenderer.invoke("system:open-docs"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("session:status", listener);
    return () => ipcRenderer.removeListener("session:status", listener);
  },
});
