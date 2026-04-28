const fs = require('fs');
const path = require('path');

function getOutputDir(app, isDev, section) {
    const baseDir = isDev
        ? path.join(app.getAppPath(), 'outputs')
        : path.join(app.getPath('documents'), 'MyMoviemaker');

    const outputDir = path.join(baseDir, section);
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

module.exports = { getOutputDir };
