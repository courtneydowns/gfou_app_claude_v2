"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");

const isDev = !app.isPackaged;

const scenesIpc      = require("./ipc/scenes.cjs");
const draftsIpc      = require("./ipc/drafts.cjs");
const backupsIpc     = require("./ipc/backups.cjs");
const exportsIpc     = require("./ipc/exports.cjs");
const analysisIpc    = require("./ipc/analysis.cjs");
const sourceMatlIpc  = require("./ipc/sourceMaterial.cjs");
const rulesIpc       = require("./ipc/rules.cjs");
const { initDatabase, getDataDir } = require("./db/database.cjs");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540, height: 960, minWidth: 1000, minHeight: 640,
    backgroundColor: "#0c0b0f",
    title: "Good for One Use",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    if (process.env.GFOU_OPEN_DEVTOOLS === "1") { mainWindow.webContents.openDevTools({ mode: "detach" }); }
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  initDatabase(app);

  scenesIpc.register();
  draftsIpc.register();
  backupsIpc.register();
  exportsIpc.register();
  analysisIpc.register();
  sourceMatlIpc.register();
  rulesIpc.register();

  ipcMain.handle("app:getDataPath",    () => getDataDir(app));
  ipcMain.handle("app:openDataFolder", () => { shell.openPath(getDataDir(app)); return { ok: true }; });

  setTimeout(() => {
    try { backupsIpc.runDailyBackup(); } catch (e) { console.error("[Startup] Backup error:", e.message); }
  }, 3000);

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
