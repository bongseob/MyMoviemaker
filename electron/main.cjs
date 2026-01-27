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
        mainWindow.webContents.openDevTools(); // Auto-open DevTools in dev mode
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
const fs = require('fs');

// Fix for FFmpeg in ASAR
let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('ffprobe-static').path;

if (!isDev) {
    // electron-builder moves unpacked binaries to 'app.asar.unpacked'
    ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
    ffprobePath = ffprobePath.replace('app.asar', 'app.asar.unpacked');
}

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

ipcMain.on('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close();
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

            // 1. Scale and pad FIRST to standardize resolution (crucial for consistent text size)
            filterString += `[v1]scale=${resolution.replace('x', ':')}:force_original_aspect_ratio=decrease,pad=${resolution.replace('x', ':')}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[vscaled]`;

            const titleText = data.titleText;
            let finalVideoPin = 'vscaled';

            // 2. Add title overlay on the standard resolution
            if (titleText) {
                const wrapText = (text, width) => {
                    // Increased weight limit to reduce safe area (more chars per line)
                    const maxWeight = width > 1500 ? 26 : 11;
                    let lines = [];
                    let currentLine = '';
                    let currentWeight = 0;

                    const getWeight = (char) => (char.charCodeAt(0) > 255 ? 1 : 0.5);

                    const words = text.split(' ');
                    words.forEach(word => {
                        let wordWeight = 0;
                        for (let char of word) wordWeight += getWeight(char);

                        if (wordWeight > maxWeight) {
                            if (currentLine) lines.push(currentLine.trim());
                            let tempWord = '';
                            let tempWeight = 0;
                            for (let char of word) {
                                let cw = getWeight(char);
                                if (tempWeight + cw > maxWeight) {
                                    lines.push(tempWord);
                                    tempWord = char;
                                    tempWeight = cw;
                                } else {
                                    tempWord += char;
                                    tempWeight += cw;
                                }
                            }
                            currentLine = tempWord + ' ';
                            currentWeight = tempWeight + 0.5;
                        } else if (currentWeight + wordWeight > maxWeight) {
                            lines.push(currentLine.trim());
                            currentLine = word + ' ';
                            currentWeight = wordWeight + 0.5;
                        } else {
                            currentLine += word + ' ';
                            currentWeight += wordWeight + 0.5;
                        }
                    });

                    if (currentLine) lines.push(currentLine.trim());
                    return lines.filter(l => l.length > 0).join('\n');
                };

                const videoWidth = aspectRatio === '16:9' ? 1920 : 1080;
                const wrappedTitle = wrapText(titleText, videoWidth);

                const escapedTitle = wrappedTitle
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, "'\\''")
                    .replace(/:/g, '\\:')
                    .replace(/,/g, '\\,')
                    .replace(/\n/g, '\r');

                const fontPath = 'C\\:/Windows/Fonts/malgun.ttf';
                const position = data.titlePosition || 'bottom';

                let yPos = 'h-th-160'; // Tighter bottom margin
                if (position === 'top') yPos = '110'; // Tighter top margin
                else if (position === 'center') yPos = '(h-th)/2';

                filterString += `; [vscaled]drawtext=fontfile='${fontPath}':text='${escapedTitle}':fontcolor=white:fontsize=100:x=(w-text_w)/2:y=${yPos}:borderw=4:bordercolor=black:fix_bounds=true:text_align=center:line_spacing=20[vout]`;
                finalVideoPin = 'vout';
            } else {
                // If no text, the output of scale is our final output
                filterString += `; [vscaled]null[vout]`;
            }

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
