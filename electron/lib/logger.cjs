const fs = require('fs');
const path = require('path');

function getLogPath(app) {
    return path.join(app.getPath('userData'), 'main.log');
}

function writeAppLog(app, message, data) {
    try {
        const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
        fs.appendFileSync(getLogPath(app), `[${new Date().toISOString()}] ${message}${suffix}\n`, 'utf8');
    } catch (_error) {
        // Logging must never break app startup.
    }
}

module.exports = { writeAppLog };
