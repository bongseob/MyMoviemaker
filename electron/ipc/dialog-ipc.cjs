const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { getOutputDir } = require('../lib/paths.cjs');
const { AUDIO_EXTENSIONS, assertExistingFile } = require('../lib/validation.cjs');

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

    ipcMain.handle('open-audio-file', async (_event, filePath) => {
        try {
            const audioPath = assertExistingFile(filePath, 'Audio file', AUDIO_EXTENSIONS);
            const errorMessage = await shell.openPath(audioPath);

            if (errorMessage) {
                return { success: false, error: errorMessage };
            }

            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });
}

module.exports = { registerDialogIpc };
