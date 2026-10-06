const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ultimateTvSurface", {
  onFrame: (callback) => {
    const listener = (_event, frame) => callback(frame);
    ipcRenderer.on("tv:frame", listener);
    return () => ipcRenderer.removeListener("tv:frame", listener);
  },

  frameConsumed: () => ipcRenderer.send("tv:frame-consumed"),

  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("tv:status", listener);
    return () => ipcRenderer.removeListener("tv:status", listener);
  },

  key: (keyCode) => ipcRenderer.send("tv:key", keyCode),
  text: (value) => ipcRenderer.send("tv:text", value),
  tap: (x, y) => ipcRenderer.send("tv:tap", { x, y }),
  toggleFullscreen: () => ipcRenderer.invoke("tv:toggle-fullscreen"),
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("tv:window-state", listener);
    return () => ipcRenderer.removeListener("tv:window-state", listener);
  },
  exit: () => ipcRenderer.invoke("tv:exit"),
});
