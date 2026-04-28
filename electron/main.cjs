const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { loadEnvironment } = require('./lib/env.cjs');
const { installProcessSafety } = require('./lib/process-safety.cjs');
const { writeAppLog } = require('./lib/logger.cjs');
const { createWindow } = require('./window.cjs');
const { registerIpcHandlers } = require('./ipc/index.cjs');

installProcessSafety(app);
loadEnvironment(app);
writeAppLog(app, 'main loaded', { isPackaged: app.isPackaged, appPath: app.getAppPath() });

const isDev = !app.isPackaged;

app.whenReady().then(() => {
    writeAppLog(app, 'app ready');
    createWindow({ app, isDev });
    writeAppLog(app, 'window creation requested');
    registerIpcHandlers({ ipcMain, dialog, app, isDev });
    writeAppLog(app, 'ipc registered');

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow({ app, isDev });
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
