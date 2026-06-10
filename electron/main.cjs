const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const authProtocols = ["amig", "icrackedsahil"];
let mainWindow = null;
let pendingAuthUrl = null;

for (const protocol of authProtocols) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(protocol);
  }
}

function getAuthUrl(values) {
  return values.find((value) => authProtocols.some((protocol) => value.startsWith(`${protocol}://`))) || null;
}

function deliverAuthUrl(rawUrl) {
  if (!authProtocols.some((protocol) => rawUrl?.startsWith(`${protocol}://`))) return;

  pendingAuthUrl = rawUrl;

  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("auth:callback", pendingAuthUrl);
    pendingAuthUrl = null;
  }

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    deliverAuthUrl(getAuthUrl(commandLine));
  });
}

app.on("open-url", (event, rawUrl) => {
  event.preventDefault();
  deliverAuthUrl(rawUrl);
});

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    show: false,
    icon: path.join(__dirname, "app-icon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#070b13",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    const target = new URL(url);
    const current = new URL(currentUrl);

    if (target.origin !== current.origin) {
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingAuthUrl) {
      mainWindow.webContents.send("auth:callback", pendingAuthUrl);
      pendingAuthUrl = null;
    }
  });

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  deliverAuthUrl(getAuthUrl(process.argv));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
