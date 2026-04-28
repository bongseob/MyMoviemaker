const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { getErrorMessage } = require('../lib/errors.cjs');
const { getOutputDir } = require('../lib/paths.cjs');
const { SRT_EXTENSIONS, assertExistingFile, assertPlainObject, assertText } = require('../lib/validation.cjs');

function stripMarkdownFence(text) {
    const lines = String(text || '').trim().split(/\r?\n/);

    if (lines.length > 0 && /^```\w*\s*$/.test(lines[0].trim())) {
        lines.shift();
    }

    if (lines.length > 0 && /^```\s*$/.test(lines[lines.length - 1].trim())) {
        lines.pop();
    }

    return lines.join('\n').trim();
}

function getDateBaseName() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    return `${yyyy}${mm}${dd}`;
}

function createUniqueFilePath(directory, fileName) {
    const parsedName = path.parse(fileName);
    let candidate = path.join(directory, fileName);
    let index = 1;

    while (fs.existsSync(candidate)) {
        candidate = path.join(directory, `${parsedName.name}_${index}${parsedName.ext}`);
        index += 1;
    }

    return candidate;
}

function findLatestSunoMp3(sunoDir) {
    if (!fs.existsSync(sunoDir)) {
        throw new Error(`Suno MP3 폴더를 찾을 수 없습니다: ${sunoDir}`);
    }

    const mp3Files = fs.readdirSync(sunoDir)
        .filter((fileName) => path.extname(fileName).toLowerCase() === '.mp3')
        .map((fileName) => {
            const filePath = path.join(sunoDir, fileName);
            const stat = fs.statSync(filePath);
            return { filePath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (mp3Files.length === 0) {
        throw new Error(`Suno MP3 파일이 없습니다: ${sunoDir}`);
    }

    return mp3Files[0].filePath;
}

function registerSubtitleIpc({ ipcMain, app, isDev }) {
    ipcMain.handle('generate-srt-from-suno', async (event) => {
        try {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');

            const sunoDir = getOutputDir(app, isDev, 'suno');
            const mp3Path = findLatestSunoMp3(sunoDir);
            const outputPath = createUniqueFilePath(sunoDir, `${getDateBaseName()}.srt`);
            const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
            const openai = new OpenAI({ apiKey });

            event.sender.send('refine-status', `Suno MP3 파일을 찾았습니다: ${path.basename(mp3Path)}`);
            event.sender.send('refine-status', 'MP3에서 SRT 자막을 생성하고 있습니다...');

            const srtContent = await openai.audio.transcriptions.create({
                file: fs.createReadStream(mp3Path),
                model,
                response_format: 'srt',
                language: 'ko'
            });

            fs.writeFileSync(outputPath, String(srtContent).trim() + '\n', 'utf8');
            event.sender.send('refine-status', `SRT 생성 완료: ${outputPath}`);

            return { success: true, outputPath, sourcePath: mp3Path };
        } catch (error) {
            console.error('Error generating SRT from Suno MP3:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    ipcMain.handle('save-srt-content', async (_event, data) => {
        try {
            const payload = assertPlainObject(data, 'SRT save payload');
            const srtPath = assertExistingFile(payload.srtPath, 'SRT file', SRT_EXTENSIONS);
            const content = assertText(payload.content, 'SRT content', 500000);

            fs.writeFileSync(srtPath, content.trim() + '\n', 'utf8');

            return { success: true, outputPath: srtPath };
        } catch (error) {
            console.error('Error saving SRT content:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });

    // --- Subtitle Refiner ---
    ipcMain.handle('refine-subtitles', async (event, data) => {
        try {
            const payload = assertPlainObject(data, 'Subtitle refinement payload');
            const srtPath = assertExistingFile(payload.srtPath, 'SRT file', SRT_EXTENSIONS);
            const summaryText = assertText(payload.summaryText, 'Summary text', 50000);
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
                
            const openai = new OpenAI({ apiKey });    
            const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';    
        
            event.sender.send('refine-status', '자막 파일을 읽고 있습니다...');    
            const srtContent = fs.readFileSync(srtPath, 'utf8');    
        
            // SRT 블록 분리    
            const blocks = srtContent.trim().split(/\n\s*\n/);    
            const totalBlocks = blocks.length;    
            const refinedBlocks = [];    
            const chunkSize = 15;    
        
            event.sender.send('refine-status', `총 ${totalBlocks}개의 자막 블록 처리를 시작합니다...`);    
        
            for (let i = 0; i < totalBlocks; i += chunkSize) {    
                const chunk = blocks.slice(i, i + chunkSize).join('\n\n');    
                const currentProgress = Math.min(i + chunkSize, totalBlocks);    
                    
                event.sender.send('refine-status', `교정 중... (${currentProgress}/${totalBlocks} 블록)`);    
        
                const prompt = `    
    원본 텍스트(정답 가이드):    
    """    
    ${summaryText}    
    """    
        
    교정할 SRT 자막 청크:    
    """    
    ${chunk}    
    """    
        
    지시사항:    
    1. 제공된 '원본 텍스트'를 참고하여 SRT 자막의 오타, 잘못 인식된 단어, 띄어쓰기를 정확하게 수정하세요.    
    2. 타임스탬프(예: 00:00:10,000 --> 00:00:15,000)와 자막 번호는 **절대** 변경하거나 삭제하지 마세요. 형식을 엄격히 유지해야 합니다.    
    3. 원본 텍스트에 없는 부연 설명은 추가하지 마세요.    
    4. "구독, 좋아요"와 같은 문구는 SRT에 포함되어 있다면 원본 텍스트의 맥락에 맞게 유지하세요.    
    5. 결과는 SRT 형식의 자막 청크만 응답하세요. 다른 설명은 포함하지 마세요.    
    `;    
        
                const response = await openai.chat.completions.create({    
                    model: model,    
                    messages: [{ role: 'user', content: prompt }],    
                    temperature: 0,    
                });    
        
                refinedBlocks.push(stripMarkdownFence(response.choices[0].message.content));
            }    
        
            const outputDir = path.dirname(srtPath);    
            const ext = path.extname(srtPath);    
            const basename = path.basename(srtPath, ext);    
            const outputPath = path.join(outputDir, `${basename}_refined${ext}`);    
        
            fs.writeFileSync(outputPath, refinedBlocks.join('\n\n'), 'utf8');
            const refinedContent = refinedBlocks.join('\n\n');
                
            event.sender.send('refine-status', '교정 완료!');    
            return { success: true, outputPath, data: { content: refinedContent } };
        
        } catch (error) {
            console.error('Error refining subtitles:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
}

module.exports = { registerSubtitleIpc };
