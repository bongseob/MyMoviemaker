const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false, // Local file access
        },
        titleBarStyle: 'hidden',
        backgroundColor: '#0f172a',
    });

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

const ffprobePath = require('ffprobe-static').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Helper to get audio duration
function getAudioDuration(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) resolve(0);
            else resolve(metadata.format.duration);
        });
    });
}

// IPC Handlers
ipcMain.handle('select-files', async (event, options) => {
    const result = await dialog.showOpenDialog(options);
    return result;
});

ipcMain.handle('select-save-path', async (event, options) => {
    const result = await dialog.showSaveDialog(options);
    return result;
});

ipcMain.handle('export-video', async (event, data) => {
    const { slides, audioPath, outputPath, aspectRatio } = data;
    const resolution = aspectRatio === '16:9' ? '1920x1080' : '1080x1920';

    let totalDuration = 0;
    if (audioPath) {
        totalDuration = await getAudioDuration(audioPath.replace('file://', ''));
    } else {
        totalDuration = slides.reduce((acc, s) => acc + s.duration, 0);
    }

    console.log('Exporting video to:', outputPath);
    console.log('Target Duration:', totalDuration, 'seconds');

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        try {
            // 1. Combine images
            slides.forEach((slide, index) => {
                const cleanPath = slide.path.replace('file://', '');
                if (fs.existsSync(cleanPath)) {
                    // If solo image should cover audio, or it's the last image
                    // We use -t on output, so a long loop here is fine as long as we cap output
                    command = command.input(cleanPath).loop(totalDuration || 3600);
                }
            });

            // 2. Add Audio
            if (audioPath) {
                command = command.input(audioPath.replace('file://', ''));
            }

            const videoLabels = slides.map((_, i) => `[${i}:v]`).join('');
            const audioInputIndex = slides.length;

            let filterString = '';
            if (slides.length > 1) {
                filterString += `${videoLabels}concat=n=${slides.length}:v=1:a=0[v1]; `;
            } else {
                filterString += `[0:v]null[v1]; `;
            }

            filterString += `[v1]scale=${resolution.replace('x', ':')}:force_original_aspect_ratio=decrease,pad=${resolution.replace('x', ':')}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[vout]`;

            if (audioPath) {
                filterString += `; [${audioInputIndex}:a]anull[aout]`;
            }

            command.complexFilter(filterString).map('[vout]');

            if (audioPath) {
                command.map('[aout]').audioCodec('aac');
            }

            command
                .videoCodec('libx264')
                .outputOptions([
                    '-pix_fmt', 'yuv420p',
                    '-t', totalDuration.toString(), // CRITICAL: Stop exactly at audio end
                    '-shortest'
                ])
                .on('start', (cmd) => console.log('FFmpeg started:', cmd))
                .on('progress', (progress) => {
                    const percent = (progress.percent) || (progress.frames / (totalDuration * 25) * 100);
                    event.sender.send('export-progress', Math.round(Math.min(percent, 99)));
                })
                .on('end', () => {
                    console.log('Export finished');
                    event.sender.send('export-progress', 100);
                    resolve({ success: true });
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('FFmpeg error:', err.message);
                    reject(err);
                })
                .save(outputPath);
        } catch (e) {
            console.error('Setup error:', e);
            reject(e);
        }
    });
});
