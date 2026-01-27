const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    selectFiles: (options) => ipcRenderer.invoke('select-files', options),
    selectSavePath: (options) => ipcRenderer.invoke('select-save-path', options),
    exportVideo: (data) => ipcRenderer.invoke('export-video', data),
    onProgress: (callback) => ipcRenderer.on('export-progress', (event, value) => callback(value)),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    minimize: () => ipcRenderer.send('window-minimize'),
    close: () => ipcRenderer.send('window-close'),
});
