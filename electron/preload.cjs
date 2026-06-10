const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAuth", {
  onCallback(handler) {
    if (typeof handler !== "function") return () => {};

    const listener = (_event, rawUrl) => handler(rawUrl);
    ipcRenderer.on("auth:callback", listener);

    return () => ipcRenderer.removeListener("auth:callback", listener);
  },
});
