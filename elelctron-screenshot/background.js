"use strict";

import { app, protocol, BrowserWindow, ipcMain, Menu, dialog } from "electron";
import { createProtocol } from "vue-cli-plugin-electron-builder/lib";
import { autoUpdater } from "electron-updater";

const isDevelopment = process.env.NODE_ENV !== "production";
const updateUrl = "http://localhost:9999/update/";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { secure: true, standard: true } },
]);

// INFO 创建主窗口
async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: true, // INFO 集成node
      webSecurity: false, // INFO 允许跨域
      contextIsolation: false,
      enableRemoteModule: true, // INFO 允许远程模块
    },
  });

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
  } else {
    createProtocol("app");
    win.loadURL("app://./index.html");
  }
  // win.webContents.openDevTools();
  return win;
}

// INFO 创建截图窗口
async function createScreenWindow() {
  const win = new BrowserWindow({
    resizable: false,
    movable: false,
    center: true,
    frame: false,
    transparent: true,
    fullscreen: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      webSecurity: false,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });
  if (process.env.WEBPACK_DEV_SERVER_URL) {
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL + "#/screenshot");
  } else {
    win.loadURL("app://./index.html" + "#/screenshot");
  }
  // win.webContents.openDevTools();
  return win;
}

let checkForUpdates = () => {
  let completeUrl = updateUrl + (process.platform == "win32" ? "win" : "mac");
  autoUpdater.setFeedURL(completeUrl);
  autoUpdater.checkForUpdates();
  autoUpdater.on("update-downloaded", (event, releaseNotes, releaseName) => {
    mainWin.minimize();
    const dialogOpts = {
      type: "info",
      buttons: ["立即更新", "稍后再说"],
      title: "应用更新",
      message: process.platform === "win32" ? releaseNotes : releaseName,
      detail: "新版本已经下载完成，重启应用即可使用新版本。",
    };

    dialog.showMessageBox(dialogOpts, (response) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
        app.quit();
      }
    });
  });
};

// INFO 查询当前应用是否是主应用，不是的话退出，并唤醒主应用的主窗口
const gotTheLock = app.requestSingleInstanceLock();
let mainWin = null;
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  app.on("ready", async () => {
    Menu.setApplicationMenu(null);
    mainWin = await createWindow();
    mainWin.maximize();
    mainWin.show();
    checkForUpdates();
    // console.log(process.platform);
    const screenWin = await createScreenWindow();

    // INFO 主窗口关闭前先关闭截图窗口
    mainWin.on("close", () => {
      screenWin.close();
    });

    ipcMain.handle("screen:start", async () => {
      mainWin.minimize();
      screenWin.show();
      // INFO 通知启动截图
      screenWin.webContents.send("screen:shot");
    });

    // INFO 截图窗口一旦失去焦点，通知其立即reload，效果不是特别完美
    ipcMain.handle("screen:confirm", (event, data) => {
      screenWin.webContents.send("screen:reload");
      screenWin.hide();
      mainWin.restore();
      mainWin.webContents.send("screen:complete", data);
    });

    ipcMain.handle("screen:cancel", () => {
      screenWin.webContents.send("screen:reload");
      screenWin.hide();
      mainWin.restore();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === "win32") {
    process.on("message", (data) => {
      if (data === "graceful-exit") {
        app.quit();
      }
    });
  } else {
    process.on("SIGTERM", () => {
      app.quit();
    });
  }
}
