const { BrowserWindow } = require('electron');

function registerWindowIpc({ ipcMain }) {
    ipcMain.on('window-minimize', () => {
        BrowserWindow.getFocusedWindow()?.minimize();
    });

    ipcMain.on('window-close', () => {
        BrowserWindow.getFocusedWindow()?.close();
    });
}

module.exports = { registerWindowIpc };
