const path = require('path');
const fs = require('fs');

function getMacAppSiblingEnvPath() {
    const appBundleMarker = '.app';
    const execPathParts = process.execPath.split(path.sep);
    const appBundleIndex = execPathParts.findIndex((part) => part.endsWith(appBundleMarker));

    if (process.platform !== 'darwin' || appBundleIndex === -1) {
        return null;
    }

    const appParentDir = execPathParts.slice(0, appBundleIndex).join(path.sep) || path.sep;
    return path.join(appParentDir, '.env');
}

function getMacAppAncestorEnvPaths() {
    const appBundleMarker = '.app';
    const execPathParts = process.execPath.split(path.sep);
    const appBundleIndex = execPathParts.findIndex((part) => part.endsWith(appBundleMarker));

    if (process.platform !== 'darwin' || appBundleIndex === -1) {
        return [];
    }

    const paths = [];
    let currentDir = execPathParts.slice(0, appBundleIndex).join(path.sep) || path.sep;
    for (let i = 0; i < 4; i++) {
        paths.push(path.join(currentDir, '.env'));
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }

    return paths;
}

function loadEnvironment(app) {
    require('dotenv').config();

    if (!app.isPackaged) {
        return;
    }

    const possiblePaths = [
        process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, '.env') : null,
        getMacAppSiblingEnvPath(),
        ...getMacAppAncestorEnvPaths(),
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
