const { BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { getOutputDir } = require('../lib/paths.cjs');
const { AUDIO_EXTENSIONS, assertExistingFile } = require('../lib/validation.cjs');

function createUniqueFilePath(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return filePath;
    }

    const directory = path.dirname(filePath);
    const extension = path.extname(filePath);
    const baseName = path.basename(filePath, extension);
    let index = 1;
    let candidate = path.join(directory, `${baseName}_${index}${extension}`);

    while (fs.existsSync(candidate)) {
        index += 1;
        candidate = path.join(directory, `${baseName}_${index}${extension}`);
    }

    return candidate;
}

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
        const { outputSection, autoIncrementExisting, ...dialogOptions } = options;

        if (outputSection && dialogOptions.defaultPath && !path.isAbsolute(dialogOptions.defaultPath)) {
            dialogOptions.defaultPath = path.join(getOutputDir(app, isDev, outputSection), dialogOptions.defaultPath);
        }

        if (autoIncrementExisting && dialogOptions.defaultPath) {
            dialogOptions.defaultPath = createUniqueFilePath(dialogOptions.defaultPath);
        }

        const result = await dialog.showSaveDialog(dialogOptions);
        if (!result.canceled && autoIncrementExisting && result.filePath) {
            return {
                ...result,
                filePath: createUniqueFilePath(result.filePath)
            };
        }

        return result;
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
