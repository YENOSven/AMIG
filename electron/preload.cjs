const { contextBridge, ipcRenderer } = require("electron");

const pendingCallbacks = [];
const callbackHandlers = new Set();

ipcRenderer.on("auth:callback", (_event, rawUrl) => {
  if (callbackHandlers.size === 0) {
    pendingCallbacks.push(rawUrl);
    return;
  }

  for (const handler of callbackHandlers) {
    handler(rawUrl);
  }
});

contextBridge.exposeInMainWorld("desktopAuth", {
  onCallback(handler) {
    if (typeof handler !== "function") return () => {};

    callbackHandlers.add(handler);

    while (pendingCallbacks.length > 0) {
      handler(pendingCallbacks.shift());
    }

    return () => callbackHandlers.delete(handler);
  },
});
