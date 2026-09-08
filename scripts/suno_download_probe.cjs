const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { __test: { sunoMp3DownloadButton, downloadSunoMp3 } } = require('../electron/services/suno.cjs');

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
        for (const mode of ['unlock', 'two-step', 'stalled', 'unselected', 'selected', 'multiple', 'legacy']) {
            const legacy = mode === 'legacy';
            await page.setContent(legacy ? `
                <button onclick="location.href='https://download.test/song.mp3'">MP3 Audio</button>
            ` : `
                <div role="dialog" style="display:none"><button>MP3</button><button>Download</button></div>
                <div role="dialog" aria-label="Download song">
                    <button class="${mode === 'multiple' ? 'bg-foreground-primary' : ''}" onclick="this.classList.toggle('bg-foreground-primary')">M4A</button>
                    <button class="${['selected', 'multiple'].includes(mode) ? 'bg-foreground-primary' : ''}" onclick="this.classList.toggle('bg-foreground-primary')">MP3</button>
                    <button onclick="if(document.querySelectorAll('.bg-foreground-primary').length===1 && document.querySelector('.bg-foreground-primary').textContent==='MP3') location.href='https://download.test/song.mp3'">${mode === 'unlock' ? 'Unlock &amp; Download' : 'Download'}</button>
                </div>
            `);
            await page.evaluate(mode => {
                window.unlockClicks = 0;
                window.downloadClicks = 0;
                if (!['two-step', 'stalled'].includes(mode)) return;
                const action = document.querySelector('[aria-label="Download song"] button:last-child');
                action.textContent = 'Unlock & Download';
                action.onclick = () => {
                    window.unlockClicks++;
                    if (mode === 'stalled') return;
                    setTimeout(() => {
                        const replacement = action.cloneNode(true);
                        replacement.textContent = 'Download';
                        replacement.onclick = () => {
                            window.downloadClicks++;
                            location.href = 'https://download.test/song.mp3';
                        };
                        action.replaceWith(replacement);
                    }, 300);
                };
            }, mode);
            const button = await sunoMp3DownloadButton(page);
            assert.equal(await button.isVisible(), true, 'MP3 download action must be found');
            if (!legacy) assert.deepEqual(await page.locator('.bg-foreground-primary').allTextContents(), ['MP3']);
            const listeners = page.listenerCount('download');
            if (mode === 'stalled') {
                await assert.rejects(downloadSunoMp3(page, button, 1000), /timed out/);
                assert.equal(await page.evaluate(() => window.unlockClicks), 1);
                assert.equal(page.listenerCount('download'), listeners);
                continue;
            }
            const download = await downloadSunoMp3(page, button, 5000);
            assert.equal(page.listenerCount('download'), listeners);
            if (mode === 'two-step') {
                assert.deepEqual(await page.evaluate(() => [window.unlockClicks, window.downloadClicks]), [1, 1]);
            }
            assert.equal(await download.failure(), null);
            assert.equal(download.suggestedFilename(), 'song.mp3');
        }
        console.log('Suno download probe passed (unlock, two-step, timeout, formats, legacy)');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
