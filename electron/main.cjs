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

// Helper to format time for SRT (HH:MM:SS,mmm)
function formatSRTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const timeStr = date.toISOString().substr(11, 8);
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${timeStr},${ms}`;
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
    const { slides, audioPath, outputPath, aspectRatio, targetDuration, subtitlePath } = data;
    const resolution = aspectRatio === '16:9' ? '1920x1080' : '1080x1920';

    let totalDuration = targetDuration || 3;
    if (audioPath) {
        const audioLen = await getAudioDuration(audioPath.replace('file://', ''));
        if (audioLen > 0) totalDuration = audioLen;
    }

    console.log('Exporting video to:', outputPath);
    console.log('Target Duration:', totalDuration, 'seconds');

    return new Promise((resolve, reject) => {
        let command = ffmpeg();

        try {
            // 1. Prepare and standardize each image input
            const activeSlides = [];
            let filters = [];
            const resolutionStr = resolution.replace('x', ':');

            slides.forEach((slide, index) => {
                const startTime = index * 3;
                if (startTime >= totalDuration) return;

                // Path cleanup for Windows
                const cleanPath = slide.path.replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1');
                if (fs.existsSync(cleanPath)) {
                    const isLast = (index === slides.length - 1);
                    const slideDuration = Math.max(0.1, isLast ? (totalDuration - startTime) : 3);

                    if (slideDuration > 0) {
                        // Crucial: Set -framerate BEFORE input for loop
                        command = command.input(cleanPath).inputOptions([
                            '-loop 1',
                            `-t ${slideDuration}`,
                            '-framerate 25'
                        ]);
                        activeSlides.push(slide);

                        // Standardize each input with explicit fps
                        filters.push(`[${activeSlides.length - 1}:v]scale=${resolutionStr}:force_original_aspect_ratio=decrease,pad=${resolutionStr}:(ow-iw)/2:(oh-ih)/2,fps=25,setsar=1[v${activeSlides.length - 1}]`);
                    }
                }
            });

            // 2. Add Audio
            if (audioPath) {
                const cleanAudioPath = audioPath.replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1');
                command = command.input(cleanAudioPath);
            }

            const videoLabels = activeSlides.map((_, i) => `[v${i}]`).join('');
            const audioInputIndex = activeSlides.length;

            if (activeSlides.length > 1) {
                filters.push(`${videoLabels}concat=n=${activeSlides.length}:v=1:a=0[vconcat]`);
            } else if (activeSlides.length === 1) {
                filters.push(`[v0]null[vconcat]`);
            } else {
                throw new Error('No valid images found for export.');
            }

            const titleText = data.titleText;
            let finalVideoPin = 'vconcat';

            // 3. Add title overlay
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

                // REMOVED 'text_align=center' which was causing "Filter not found"
                filters.push(`[${finalVideoPin}]drawtext=fontfile='${fontPath}':text='${escapedTitle}':fontcolor=white:fontsize=100:x=(w-text_w)/2:y=${yPos}:borderw=4:bordercolor=black:fix_bounds=true:line_spacing=20[vtitle]`);
                finalVideoPin = 'vtitle';
            }

            // 4. Add Subtitles (SRT)
            let effectiveSubPath = subtitlePath;
            let tempSrtPath = null;

            // Generate temporary SRT if subtitle text exists but no sub file is selected
            if (!effectiveSubPath && data.subtitleTextContent) {
                const lines = data.subtitleTextContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length > 0) {
                    const segmentDuration = totalDuration / lines.length;
                    let srtContent = '';

                    lines.forEach((line, i) => {
                        const start = i * segmentDuration;
                        const end = (i + 1) * segmentDuration;
                        srtContent += `${i + 1}\n${formatSRTTime(start)} --> ${formatSRTTime(end)}\n${line}\n\n`;
                    });

                    tempSrtPath = path.join(app.getPath('temp'), `temp_sub_${Date.now()}.srt`);
                    fs.writeFileSync(tempSrtPath, srtContent, 'utf8');
                    effectiveSubPath = tempSrtPath;
                }
            }

            if (effectiveSubPath) {
                const cleanSubPath = effectiveSubPath.replace('file://', '')
                    .replace(/^\/([a-zA-Z]:)/, '$1')
                    .replace(/\\/g, '/')
                    .replace(/:/g, '\\:');

                filters.push(`[${finalVideoPin}]subtitles='${cleanSubPath}'[vsub]`);
                finalVideoPin = 'vsub';
            }

            // 5. Final format conversion for compatibility
            filters.push(`[${finalVideoPin}]format=yuv420p[vout]`);

            if (audioPath) {
                filters.push(`[${audioInputIndex}:a]anull[aout]`);
            }

            command.complexFilter(filters.join('; ')).map('[vout]');

            if (audioPath) {
                command.map('[aout]').audioCodec('aac');
            }

            command
                .videoCodec('libx264')
                .outputOptions([
                    '-pix_fmt', 'yuv420p',
                    '-t', totalDuration.toString(), // CRITICAL: Stop exactly at audio end
                    '-shortest',
                    '-r', '25' // Explicit output frame rate
                ])
                .on('start', (cmd) => console.log('FFmpeg started:', cmd))
                .on('progress', (progress) => {
                    const percent = (progress.percent) || (progress.frames / (totalDuration * 25) * 100);
                    event.sender.send('export-progress', Math.round(Math.min(percent, 99)));
                })
                .on('end', () => {
                    console.log('Export finished');
                    // Cleanup temp SRT
                    if (tempSrtPath && fs.existsSync(tempSrtPath)) {
                        fs.unlinkSync(tempSrtPath);
                    }
                    event.sender.send('export-progress', 100);
                    resolve({ success: true });
                })
                .on('error', (err, stdout, stderr) => {
                    console.error('FFmpeg error:', err.message);
                    // Cleanup temp SRT
                    if (tempSrtPath && fs.existsSync(tempSrtPath)) {
                        fs.unlinkSync(tempSrtPath);
                    }
                    reject(err);
                })
                .save(outputPath);
        } catch (e) {
            console.error('Setup error:', e);
            reject(e);
        }
    });
});
