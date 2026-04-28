const { BrowserWindow } = require('electron');

function registerDialogIpc({ ipcMain, dialog }) {
    ipcMain.handle('select-files', async (_event, options) => {
        return dialog.showOpenDialog(options);
    });

    ipcMain.handle('select-srt-file', async (event) => {
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        return dialog.showOpenDialog(parentWindow, {
            title: 'Select SRT File',
            properties: ['openFile'],
            filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }]
        });
    });

    ipcMain.handle('select-save-path', async (_event, options) => {
        return dialog.showSaveDialog(options);
    });
}

module.exports = { registerDialogIpc };
