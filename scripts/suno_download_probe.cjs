const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { __test: { sunoMp3DownloadButton } } = require('../electron/services/suno.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(2000);
        await page.route('https://download.test/song.mp3', route => route.fulfill({
            status: 200,
            headers: { 'content-type': 'audio/mpeg', 'content-disposition': 'attachment; filename="song.mp3"' },
            body: 'ID3-test-audio'
        }));
        for (const mode of ['unselected', 'selected', 'multiple', 'legacy']) {
            const legacy = mode === 'legacy';
            await page.setContent(legacy ? `
                <button onclick="location.href='https://download.test/song.mp3'">MP3 Audio</button>
            ` : `
                <div role="dialog" style="display:none"><button>MP3</button><button>Download</button></div>
                <div role="dialog" aria-label="Download song">
                    <button class="${mode === 'multiple' ? 'bg-foreground-primary' : ''}" onclick="this.classList.toggle('bg-foreground-primary')">M4A</button>
                    <button class="${['selected', 'multiple'].includes(mode) ? 'bg-foreground-primary' : ''}" onclick="this.classList.toggle('bg-foreground-primary')">MP3</button>
                    <button onclick="if(document.querySelectorAll('.bg-foreground-primary').length===1 && document.querySelector('.bg-foreground-primary').textContent==='MP3') location.href='https://download.test/song.mp3'">Download</button>
                </div>
            `);
            const button = await sunoMp3DownloadButton(page);
            assert.equal(await button.isVisible(), true, 'MP3 download action must be found');
            if (!legacy) assert.deepEqual(await page.locator('.bg-foreground-primary').allTextContents(), ['MP3']);
            const [download] = await Promise.all([
                page.waitForEvent('download', { timeout: 2000 }), button.click()
            ]);
            assert.equal(await download.failure(), null);
            assert.equal(download.suggestedFilename(), 'song.mp3');
        }
        console.log('Suno download probe passed (format dialog and legacy menu)');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
