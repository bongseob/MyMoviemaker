const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const {
    __test: {
        ensureSunoAdvancedMode,
        ensureSunoWriteLyricsMode,
        firstVisible,
        sunoLyricsInputs,
        sunoStyleInputs,
        sunoTitleInputs,
        replaceInputText
    }
} = require('../electron/services/suno.cjs');

chromium.use(stealth);

function candidateUserDataDirs() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return [
        path.join(appData, 'AntigravityMovieMaker', 'suno-playwright-session'),
        path.join(appData, 'mymoviemaker', 'suno-playwright-session'),
        path.join(appData, 'MyMoviemaker', 'suno-playwright-session')
    ];
}

function eventSink() {
    return {
        sender: {
            send(_channel, _message) {}
        }
    };
}

async function readField(locator) {
    return locator.evaluate((element) => {
        const tagName = element.tagName.toLowerCase();
        if (tagName === 'textarea' || tagName === 'input') {
            return element.value;
        }
        return element.textContent || '';
    });
}

(async () => {
    const existingDir = candidateUserDataDirs().find((dir) => fs.existsSync(dir));
    const userDataDir = existingDir || candidateUserDataDirs()[0];
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
    }
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true
    });

    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(7000);

        await ensureSunoAdvancedMode(page, eventSink(), { manualTimeoutMs: 3000 });
        await ensureSunoWriteLyricsMode(page, eventSink(), { manualTimeoutMs: 3000 });

        const lyricsInput = await firstVisible(page, sunoLyricsInputs(page));
        const styleInput = await firstVisible(page, sunoStyleInputs(page));
        const titleInput = await firstVisible(page, sunoTitleInputs(page));

        const lyrics = '자동 입력 확인용 가사입니다.';
        const style = '아주 빠른 한국의 랩';
        const title = '자동 입력 확인';

        await replaceInputText(page, lyricsInput, lyrics);
        await replaceInputText(page, styleInput, style);
        await replaceInputText(page, titleInput, title);
        await page.waitForTimeout(1000);

        const result = {
            lyrics: await readField(lyricsInput),
            style: await readField(styleInput),
            title: await readField(titleInput),
            cowriterPrompt: await page.locator('textarea[aria-label="Cowriter prompt"]').evaluate((element) => element.value).catch(() => null),
            createButton: await page.locator('button[aria-label="Create song"], button[aria-label*="Create song" i]').first().evaluate((element) => ({
                text: (element.textContent || '').trim(),
                ariaLabel: element.getAttribute('aria-label'),
                disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true'
            })).catch(() => null)
        };

        console.log(JSON.stringify(result, null, 2));
        if (result.lyrics !== lyrics || result.style !== style || result.title !== title || !result.createButton || result.createButton.disabled) {
            throw new Error('Suno fill probe failed: field values did not match.');
        }
    } finally {
        await context.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
