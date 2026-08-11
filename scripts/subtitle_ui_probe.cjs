const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const port = 4175;

async function waitForServer(url) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (_error) {
            // Keep polling while Vite starts.
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for the Vite subtitle UI probe server.');
}

(async () => {
    const server = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    let serverOutput = '';
    server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
    server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
    let browser;

    try {
        await waitForServer(`http://localhost:${port}`).catch((error) => {
            throw new Error(`${error.message}\n${serverOutput}`);
        });
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        await page.addInitScript(() => {
            const noOp = () => {};
            window.electron = {
                onProgress: noOp,
                onYoutubeUploadProgress: noOp,
                onTiktokStatus: noOp,
                onInstagramStatus: noOp,
                onPublishStatus: noOp,
                onSunoStatus: noOp,
                onRefineStatus: noOp,
                removeTiktokStatusListener: noOp,
                removeInstagramStatusListener: noOp,
                removePublishStatusListener: noOp,
                removeSunoStatusListener: noOp,
                removeRefineStatusListener: noOp,
                youtubeSetupAuth: async () => ({ isAuthenticated: false }),
                selectFiles: async () => ({ canceled: false, filePaths: ['C:\\probe\\song.mp3'] }),
                generateSrtFromSuno: async () => ({
                    success: true,
                    outputPath: 'C:\\probe\\generated.srt',
                    sourcePath: 'C:\\probe\\song.mp3',
                    data: { content: '1\n00:00:00,000 --> 00:00:03,000\n생성된 원본 자막' }
                }),
                refineSubtitles: async () => new Promise((resolve) => {
                    window.__resolveSubtitleRefinement = resolve;
                })
            };
        });
        await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: '자막 교정' }).click();
        await page.getByPlaceholder('Enter the article summary to use as the subtitle correction reference.').fill('생성된 원본 자막');
        await page.getByRole('button', { name: /MP3 파일 직접 선택/ }).click();
        await page.getByRole('button', { name: 'MP3로 SRT 생성' }).click();

        const generated = page.getByTestId('generated-srt-content');
        await generated.waitFor({ state: 'visible' });
        assert.match(await generated.inputValue(), /생성된 원본 자막/);

        await page.getByRole('button', { name: 'Start AI Subtitle Refinement' }).click();
        assert.match(await generated.inputValue(), /생성된 원본 자막/);

        await page.evaluate(() => {
            window.__resolveSubtitleRefinement({
                success: true,
                outputPath: 'C:\\probe\\generated_refined.srt',
                data: { content: '1\n00:00:00,000 --> 00:00:03,000\nAI 보정된 자막' }
            });
        });
        const refined = page.getByTestId('refined-srt-content');
        await refined.waitFor({ state: 'visible' });
        assert.match(await generated.inputValue(), /생성된 원본 자막/);
        assert.match(await refined.inputValue(), /AI 보정된 자막/);
        console.log('Subtitle UI probe passed');
    } finally {
        if (browser) await browser.close();
        server.kill();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
