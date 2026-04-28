const path = require('path');
const fs = require('fs');

function loadEnvironment(app) {
    require('dotenv').config();

    if (!app.isPackaged) {
        return;
    }

    const possiblePaths = [
        process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env') : null,
        path.join(path.dirname(process.execPath), '.env'),
        path.join(app.getAppPath(), '..', '.env')
    ].filter(Boolean);

    for (const envPath of possiblePaths) {
        if (fs.existsSync(envPath)) {
            require('dotenv').config({ path: envPath });
            console.log('.env loaded from:', envPath);
        }
    }
}

module.exports = { loadEnvironment };
