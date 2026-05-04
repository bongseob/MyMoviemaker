const { BrowserWindow } = require('electron');
const path = require('path');
const { getOutputDir } = require('../lib/paths.cjs');

function registerDialogIpc({ ipcMain, dialog, app, isDev }) {
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

    ipcMain.handle('select-save-path', async (_event, options = {}) => {
        const { outputSection, ...dialogOptions } = options;

        if (outputSection && dialogOptions.defaultPath && !path.isAbsolute(dialogOptions.defaultPath)) {
            dialogOptions.defaultPath = path.join(getOutputDir(app, isDev, outputSection), dialogOptions.defaultPath);
        }

        return dialog.showSaveDialog(dialogOptions);
    });
}

module.exports = { registerDialogIpc };
