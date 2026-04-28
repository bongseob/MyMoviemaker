function isBrokenPipeError(error) {
    return error && (error.code === 'EPIPE' || String(error.message || '').includes('EPIPE'));
}

function installProcessSafety(app) {
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on?.('error', (error) => {
            if (!isBrokenPipeError(error)) {
                throw error;
            }
        });
    }

    for (const method of ['log', 'warn', 'error']) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            try {
                original(...args);
            } catch (error) {
                if (!isBrokenPipeError(error)) {
                    throw error;
                }
            }
        };
    }

    process.on('uncaughtException', (error) => {
        if (isBrokenPipeError(error)) {
            return;
        }

        try {
            console.error('Uncaught exception in main process:', error);
        } finally {
            app.quit();
        }
    });
}

module.exports = { installProcessSafety };
