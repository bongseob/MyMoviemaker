const { registerDialogIpc } = require('./dialog-ipc.cjs');
const { registerWindowIpc } = require('./window-ipc.cjs');
const { registerVideoExportIpc } = require('../services/video-export.cjs');
const { registerYoutubeIpc } = require('../services/youtube.cjs');
const { registerArticleIpc } = require('../services/article.cjs');
const { registerSunoIpc } = require('../services/suno.cjs');
const { registerSubtitleIpc } = require('../services/subtitle-refiner.cjs');

function registerIpcHandlers(deps) {
    registerDialogIpc(deps);
    registerWindowIpc(deps);
    registerVideoExportIpc(deps);
    registerYoutubeIpc(deps);
    registerArticleIpc(deps);
    registerSunoIpc(deps);
    registerSubtitleIpc(deps);
}

module.exports = { registerIpcHandlers };
