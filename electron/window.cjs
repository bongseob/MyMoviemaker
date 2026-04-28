const { BrowserWindow } = require('electron');
const path = require('path');
const { writeAppLog } = require('./lib/logger.cjs');

let mainWindow = null;

function createWindow({ app, isDev }) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        return mainWindow;
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        show: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: !isDev,
        },
        titleBarStyle: 'hidden',
        backgroundColor: '#0f172a',
    });
    writeAppLog(app, 'browser window created', {
        id: mainWindow.id,
        bounds: mainWindow.getBounds(),
        visible: mainWindow.isVisible()
    });

    mainWindow.on('closed', () => {
        writeAppLog(app, 'browser window closed');
        mainWindow = null;
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        console.error('Main window failed to load:', { errorCode, errorDescription, validatedURL });
        writeAppLog(app, 'main window failed to load', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('did-finish-load', () => {
        writeAppLog(app, 'main window finished load', {
            visible: mainWindow?.isVisible(),
            bounds: mainWindow?.getBounds()
        });
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        writeAppLog(app, 'loading app file', { indexPath });
        mainWindow.loadFile(indexPath);
    }

    return mainWindow;
}

module.exports = { createWindow };
