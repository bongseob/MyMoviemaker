const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { validateExportPayload } = require('../lib/validation.cjs');

function configureFfmpeg({ app, isDev }) {
    let ffmpegPath = require('ffmpeg-static');
    let ffprobePath = require('ffprobe-static').path;

    if (!isDev) {
        const unpackedFfmpeg = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
        const unpackedFfprobe = ffprobePath.replace('app.asar', 'app.asar.unpacked');

        if (fs.existsSync(unpackedFfmpeg)) {
            ffmpegPath = unpackedFfmpeg;
        } else {
            console.warn('Unpacked ffmpeg not found at:', unpackedFfmpeg);
        }

        if (fs.existsSync(unpackedFfprobe)) {
            ffprobePath = unpackedFfprobe;
        } else {
            console.warn('Unpacked ffprobe not found at:', unpackedFfprobe);
        }
    }

    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);

    console.log('--- FFmpeg Path Diagnostic ---');
    console.log('Is Dev:', isDev);
    console.log('App Path:', app.getAppPath());
    console.log('Resolved ffmpegPath:', ffmpegPath, 'Exists:', fs.existsSync(ffmpegPath));
    console.log('Resolved ffprobePath:', ffprobePath, 'Exists:', fs.existsSync(ffprobePath));
    console.log('------------------------------');

    return { ffmpegPath, ffprobePath };
}

function getAudioDuration(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) resolve(0);
            else resolve(metadata.format.duration);
        });
    });
}

function formatSRTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const timeStr = date.toISOString().substr(11, 8);
    const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
    return `${timeStr},${ms}`;
}

function registerVideoExportIpc({ ipcMain, app, isDev }) {
    const { ffmpegPath, ffprobePath } = configureFfmpeg({ app, isDev });

    ipcMain.handle('export-video', async (event, data) => {
        data = validateExportPayload(data);
        const { slides, audioPath, outputPath, aspectRatio, targetDuration, subtitlePath, imageDuration } = data;
        const resolution = aspectRatio === '16:9' ? '1920x1080' : '1080x1920';
        const interval = imageDuration || 5;
    
        let totalDuration = targetDuration || 15;
        if (audioPath) {
            const audioLen = await getAudioDuration(audioPath);
            if (audioLen > 0) totalDuration = audioLen;
        }
        
        console.log('Exporting video to:', outputPath);    
        console.log('Final Total Duration:', totalDuration, 'seconds');    
        console.log('Exporting using ffmpegPath:', ffmpegPath, 'ffprobePath:', ffprobePath);    
        
        return new Promise((resolve, reject) => {    
            let command = ffmpeg();    
        
            try {    
                // 1. Prepare and standardize each image input    
                const activeSlides = [];    
                let filters = [];    
                const resolutionStr = resolution.replace('x', ':');    
        
                let currentTime = 0;    
                let loopIndex = 0;    
        
                while (currentTime < totalDuration) {    
                    const slide = slides[loopIndex % slides.length];
                    
                    const cleanPath = slide.path;
        
                    if (fs.existsSync(cleanPath)) {    
                        const remainingTime = totalDuration - currentTime;    
                        const slideDuration = Math.min(interval, Math.max(0.1, remainingTime));    
        
                        console.log(`[Slide ${loopIndex}] Path: ${cleanPath} | Duration: ${slideDuration}`);    
        
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
                                
                            currentTime += slideDuration;    
                        } else {    
                            break;    
                        }    
                    }    
                    loopIndex++;    
                        
                    // Safety break to avoid infinite loops in case all slides are invalid    
                    if (activeSlides.length === 0 && loopIndex >= slides.length) break;     
                }    
        
                // 2. Add Audio
                if (audioPath) {
                    command = command.input(audioPath);
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
                        .replace(/'/g, "'\\\\\\''") // Double-escape single quotes for FFmpeg filter    
                        .replace(/:/g, '\\:')    
                        .replace(/,/g, '\\,');    
                    // Removed .replace(/\n/g, '\r') as it's non-standard and causes issues    
        
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
                    // Remove file://, handle URI encoding, fix drive letter, and handle slashes/quotes for FFmpeg filter
                    const cleanSubPath = effectiveSubPath
                        .replace(/\\/g, '/')
                        .replace(/:/g, '\\:')
                        .replace(/'/g, "'\\\\\\''"); // Escape single quotes in path
        
                    filters.push(`[${finalVideoPin}]subtitles=filename='${cleanSubPath}'[vsub]`);    
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
                        '-r', '25' // Explicit output frame rate    
                    ])    
                    .on('start', (cmd) => console.log('FFmpeg started:', cmd))    
                    .on('progress', (progress) => {    
                        // Prioritize frame-based progress since progress.percent can be unreliable with complex filters    
                        const expectedTotalFrames = Math.max(1, totalDuration * 25);    
                        const percentFromFrames = (progress.frames / expectedTotalFrames) * 100;    
        
                        // If progress.percent is valid and looks reasonable, we can consider it,     
                        // but frames/totalFrames is usually more accurate for our loop-based video.    
                        const finalPercent = Math.max(0, Math.min(percentFromFrames || 0, 99));    
        
                        event.sender.send('export-progress', Math.round(finalPercent));    
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
                        console.error('FFmpeg stderr:', stderr); // Log detailed errors    
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
}

module.exports = { registerVideoExportIpc };
