const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
require('dotenv').config();
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
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

// Youtube OAuth2 Config
let oauth2Client = null;
const TOKEN_PATH = path.join(app.getPath('userData'), 'youtube-token.json');

function saveToken(token) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
}

function loadToken() {
    if (fs.existsSync(TOKEN_PATH)) {
        return JSON.parse(fs.readFileSync(TOKEN_PATH));
    }
    return null;
}

// Fix for FFmpeg in ASAR
let ffmpegPath = require('ffmpeg-static');
let ffprobePath = require('ffprobe-static').path;

// In Dev mode, ffmpeg-static might return a path ending in `app.asar.unpacked` if it's erroneously cached, 
// but generally it returns the direct node_modules path.
if (!isDev) {
    // electron-builder moves unpacked binaries to 'app.asar.unpacked'
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

// Set the exact path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

console.log('--- FFmpeg Path Diagnostic ---');
console.log('Is Dev:', isDev);
console.log('App Path:', app.getAppPath());
console.log('Resolved ffmpegPath:', ffmpegPath, 'Exists:', fs.existsSync(ffmpegPath));
console.log('Resolved ffprobePath:', ffprobePath, 'Exists:', fs.existsSync(ffprobePath));
console.log('------------------------------');

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
    const { slides, audioPath, outputPath, aspectRatio, targetDuration, subtitlePath, imageDuration } = data;
    const resolution = aspectRatio === '16:9' ? '1920x1080' : '1080x1920';
    const interval = imageDuration || 5;

    let totalDuration = targetDuration || 15;
    if (audioPath) {
        const decodedPath = decodeURIComponent(audioPath.replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1'));
        const audioLen = await getAudioDuration(decodedPath);
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
                
                // Path cleanup for Windows: Remove file://, handle URI encoding, and fix drive letter
                const rawPath = slide.path.replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1');
                const cleanPath = decodeURIComponent(rawPath);

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
                const cleanAudioPath = decodeURIComponent(audioPath.replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1'));
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
                const cleanSubPath = decodeURIComponent(effectiveSubPath.replace('file://', '')
                    .replace(/^\/([a-zA-Z]:)/, '$1'))
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

ipcMain.handle('youtube-setup-auth', async (event, { clientId, clientSecret } = {}) => {
    const finalClientId = clientId || process.env.YOUTUBE_CLIENT_ID;
    const finalClientSecret = clientSecret || process.env.YOUTUBE_CLIENT_SECRET;

    if (!finalClientId || !finalClientSecret) {
        return { isAuthenticated: false, error: 'Missing Client ID or Secret' };
    }

    oauth2Client = new google.auth.OAuth2(
        finalClientId,
        finalClientSecret,
        'http://localhost:3000/callback'
    );
    const token = loadToken();
    if (token) {
        oauth2Client.setCredentials(token);
        return { isAuthenticated: true };
    }
    return { isAuthenticated: false };
});

ipcMain.handle('youtube-login', async (event) => {
    if (!oauth2Client) throw new Error('OAuth2 Client not initialized. Call setup-auth first.');

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.upload'],
        prompt: 'consent'
    });

    const { shell } = require('electron');
    shell.openExternal(authUrl);

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                if (req.url.indexOf('/callback') > -1) {
                    const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
                    const code = qs.get('code');
                    res.end('Authentication successful! You can close this window.');
                    server.close();

                    const { tokens } = await oauth2Client.getToken(code);
                    oauth2Client.setCredentials(tokens);
                    saveToken(tokens);
                    resolve({ success: true });
                }
            } catch (e) {
                reject(e);
            }
        });

        server.listen(3000);
    });
});

ipcMain.handle('youtube-upload', async (event, { videoPath, title, description, privacyStatus }) => {
    if (!oauth2Client) throw new Error('Not authenticated');

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const fileSize = fs.statSync(videoPath).size;

    return new Promise((resolve, reject) => {
        youtube.videos.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: { title, description },
                status: { privacyStatus }
            },
            media: {
                body: fs.createReadStream(videoPath)
            }
        }, {
            onUploadProgress: (evt) => {
                const progress = Math.round((evt.bytesRead / fileSize) * 100);
                event.sender.send('youtube-upload-progress', progress);
            }
        }, (err, res) => {
            if (err) reject(err);
            else resolve(res.data);
        });
    });
});

// --- OpenAI Article Summarizer ---
const { OpenAI } = require('openai');

ipcMain.handle('process-article', async (event, text) => {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY가 .env 파일에 설정되어 있지 않습니다.');
        }
        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        const openai = new OpenAI({ apiKey });

        const prompt = `
당신은 20년 경력의 인터넷신문 편집기자이다.
지자체에서 배포한 보도자료를 읽고 인터넷신문 기사 형식으로 재작성하라.
결과는 반드시 JSON 형식으로 응답해야 한다.

[기본 원칙]
- 기사 내용은 반드시 제공된 보도자료 내용만 사용한다
- 새로운 사실이나 추측을 추가하지 않는다
- 문장을 자연스럽게 다듬는 것만 허용된다
- 행정 홍보 문체를 언론 기사 문체로 정리한다

[출력 형식 (JSON 객체의 Key)]
- "title": [제목]
- "subtopics": [소주제 배열]
- "hashtags": [해시태그 배열]
- "summary": [요약기사]
- "content": [기사내용]

[제목 작성 규칙]
- 핵심 키워드 + 정책/사업 + 목적 구조로 작성
- 25~60자 사이 권장
- 클릭 유도형 문장 금지

[소주제 작성 규칙]
- 기사 핵심 내용을 3개로 정리
- 설명 문장이 아니라 주제 형태

[해시태그 규칙]
- 기사 핵심 키워드 3개 추출
- 마지막 태그는 반드시 #데일리메이커 (총 4개가 되어도 무방함)

[기사 작성 규칙]
- 첫 문장은 핵심 사실 전달
- 육하원칙 중심 작성
- 문단은 3~6개
- 홍보 문구는 최소화

[요약기사(summary) 작성 규칙]
- 400~420자
- 기사 핵심 내용을 간결하게 정리
- 마지막 문장은 반드시 "구독, 좋아요"로 끝낸다
- 주의: 요약기사 안에서는 "(구청장 박희영)" 등 직함 표기 문구를 반드시 제거한다.

[기사내용(content) 작성 규칙]
- 원문 보도자료의 직함 및 표기(예: "(구청장 박희영)", "박희영 용산구청장" 등)는 절대 제거하지 않고 반드시 기사내용에 포함시켜 유지한다.
- 요약기사에서 제거했던 직함이라도, 본문(content)에서는 반드시 포함하여 작성해야 한다.
- 단, 문맥상 자연스럽게 표현만 다듬는다.

[검증 단계]
각 항목별로 다음 규칙이 정확히 지켜졌는지 최종 확인하라:
1. 요약기사(summary): "(구청장 박희영)" 등 직함 표기 문구가 완전히 제거되었는가?
2. 기사내용(content): 원문의 직함 표기(예: "(구청장 박희영)")가 누락되지 않고 본문에 그대로 유지되었는가? (누락되었다면 다시 추가할 것)

[출력 규칙]
- 전체 결과는 지정된 JSON 형식의 코드 블록 하나로 작성한다
- 강조 표시(굵게 등)는 사용하지 않는다

보도자료 원문:
${text}
`;

        const response = await openai.chat.completions.create({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" }
        });

        const jsonString = response.choices[0].message.content;
        const parsedJson = JSON.parse(jsonString);

        // Auto-save logic
        const baseDir = isDev 
            ? path.join(app.getAppPath(), 'outputs', 'articles') 
            : path.join(app.getPath('documents'), 'MyMoviemaker', 'articles');
        
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        const date = new Date();
        const timestamp = date.toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
        const filename = `article_${timestamp}.json`;
        const filePath = path.join(baseDir, filename);

        fs.writeFileSync(filePath, JSON.stringify(parsedJson, null, 2), 'utf-8');

        return { success: true, data: parsedJson, savedPath: filePath };
    } catch (error) {
        console.error('Error processing article:', error);
        return { success: false, error: error.message };
    }
});

// --- Playwright Article Publisher ---
const { chromium } = require('playwright');

ipcMain.handle('publish-article', async (event, articleData) => {
    try {
        const adminId = process.env.ADMIN_USER_ID;
        const adminPw = process.env.ADMIN_USER_PW;

        if (!adminId || !adminPw || adminId === 'your_admin_id') {
            throw new Error('관리자 아이디 또는 비밀번호가 .env 파일에 설정되지 않았습니다. .env 파일을 확인해 주세요.');
        }

        event.sender.send('publish-status', '브라우저를 열고 있습니다...');
        const browser = await chromium.launch({ headless: false }); // 과정을 보여주기 위해 창을 띄움
        const context = await browser.newContext();
        const page = await context.newPage();

        event.sender.send('publish-status', '로그인 페이지에 접속 중입니다...');
        await page.goto('https://www.d-maker.kr/admin/adminLoginForm.html');
        
        event.sender.send('publish-status', '로그인을 시도합니다...');
        await page.fill('#user_id', adminId);
        await page.fill('#user_pw', adminPw);
        
        // 로그인 제출 후 페이지 이동 대기
        await Promise.all([
            page.waitForNavigation(),
            page.click('button[type="submit"]')
        ]);

        event.sender.send('publish-status', '로그인 완료! 기사 등록 페이지로 이동합니다...');
        
        // 3. 왼쪽 메뉴의 "기사등록" 누르기 (혹은 직접 URL 이동)
        // 안전하게 URL로 직접 이동 (혹은 UI 클릭)
        await page.goto('https://www.d-maker.kr/news/adminArticleWriteForm.html?mode=input');
        await page.waitForLoadState('networkidle');

        event.sender.send('publish-status', '기사 등록 폼에 내용을 채우고 있습니다...');

        // 4. 데이터 입력
        // 4-1. 기사 제목
        if (articleData.title) {
            await page.fill('#title', articleData.title);
        }

        // 4-2. 부제목 (소주제 배열을 줄바꿈으로 연결하여 입력, 각 항목 앞에 '- ' 추가)
        if (articleData.subtopics && articleData.subtopics.length > 0) {
            const subTitleText = articleData.subtopics.map(t => `- ${t}`).join('\n');
            await page.fill('#subTitle', subTitleText);
        }

        // 4-3. 키워드 (# 제외하고 하나씩 입력 후 스페이스바) - 먼저 입력
        if (articleData.hashtags && articleData.hashtags.length > 0) {
            const tagInputSelector = '.tagit-new input.ui-autocomplete-input';
            await page.waitForSelector(tagInputSelector, { state: 'visible' });

            for (let tag of articleData.hashtags) {
                const cleanTag = tag.replace(/^#/, '').trim();
                if (cleanTag) {
                    await page.fill(tagInputSelector, cleanTag);
                    await page.press(tagInputSelector, 'Space');
                    await page.waitForTimeout(100); // UI 반영 대기
                }
            }
        }

        // 4-4. 기사내용 (CKEditor 텍스트 붙여넣기 팝업 활용) - 가장 마지막에 입력
        if (articleData.content) {
            // 에디터가 완전히 로드되어 버튼이 활성화될 때까지 대기
            await page.waitForSelector('.cke_button__pastetext:not(.cke_button_disabled)', { state: 'visible', timeout: 15000 });
            
            // "텍스트로 붙여넣기" 버튼 클릭
            await page.click('.cke_button__pastetext');
            
            // 팝업 창의 iframe 대기 (cke_pasteframe 클래스 사용)
            await page.waitForSelector('.cke_pasteframe', { state: 'visible' });
            
            // iframe 내의 body 요소에 기사 내용만 붙여넣기 (요약 기사 제외)
            // 엔터(줄바꿈) 값이 소실되지 않도록 innerText를 직접 할당하여 브라우저가 자동 처리하게 함
            const pasteFrame = page.frameLocator('.cke_pasteframe');
            await pasteFrame.locator('body').evaluate((body, content) => {
                body.innerText = content;
            }, articleData.content);
            
            // "확인" 버튼 클릭
            try {
                await page.click('.cke_dialog_ui_button_ok');
            } catch (e) {
                // 클릭 실패시 최후의 수단으로 title 기반 클릭
                await page.locator('.cke_dialog a[title="확인"]').click();
            }
            
            // 팝업이 닫힐 때까지 잠시 대기
            await page.waitForSelector('.cke_pasteframe', { state: 'hidden' });
            await page.waitForTimeout(500); // UI 반영 대기
        }

        event.sender.send('publish-status', '내용 입력 완료! 저장 버튼을 클릭합니다...');

        // 저장 시 나타나는 alert 창(예: "등록되었습니다")을 자동으로 수락하도록 핸들러 등록
        page.once('dialog', async dialog => {
            console.log('Dialog message:', dialog.message());
            await dialog.accept();
        });

        // 5. 저장하기 버튼 클릭
        await page.click('button[type="submit"].nd-pink');
        
        // 페이지 이동 또는 저장이 완료될 때까지 잠시 대기
        await page.waitForTimeout(3000);

        event.sender.send('publish-status', '기사 등록이 완료되었습니다!');
        // 브라우저를 닫지 않고 유지 (사용자가 등록된 기사를 직접 확인할 수 있도록 함)
        // await browser.close();

        return { success: true, message: '어드민 페이지에 기사가 성공적으로 자동 등록되었습니다.' };
    } catch (error) {
        console.error('Error publishing article:', error);
        return { success: false, error: error.message };
    }
});
