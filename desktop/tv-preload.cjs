const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ultimateTvSurface", {
  onFrame: (callback) => {
    const listener = (_event, frame) => callback(frame);
    ipcRenderer.on("tv:frame", listener);
    return () => ipcRenderer.removeListener("tv:frame", listener);
  },

  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("tv:status", listener);
    return () => ipcRenderer.removeListener("tv:status", listener);
  },

  key: (keyCode) => ipcRenderer.send("tv:key", keyCode),
  tap: (x, y) => ipcRenderer.send("tv:tap", { x, y }),
  exit: () => ipcRenderer.invoke("tv:exit"),
});
