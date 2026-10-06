const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ultimateTv", {
  systemInfo: () => ipcRenderer.invoke("system:info"),

  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  installRuntime: (licenseAccepted) =>
    ipcRenderer.invoke("runtime:install", { licenseAccepted }),
  removeRuntime: () => ipcRenderer.invoke("runtime:remove"),

  avds: () => ipcRenderer.invoke("session:avds"),
  status: () => ipcRenderer.invoke("session:status"),
  start: (options) => ipcRenderer.invoke("session:start", options),
  stop: () => ipcRenderer.invoke("session:stop"),

  openDocs: () => ipcRenderer.invoke("system:open-docs"),
  openAndroidLicense: () => ipcRenderer.invoke("system:open-android-license"),

  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("session:status", listener);
    return () => ipcRenderer.removeListener("session:status", listener);
  },

  onRuntimeStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("runtime:status", listener);
    return () => ipcRenderer.removeListener("runtime:status", listener);
  },
});
