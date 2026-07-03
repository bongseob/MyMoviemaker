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
        replaceInputText,
        clickSunoCreateButton
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

function removeBrowserLocks(userDataDir) {
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        const file = path.join(userDataDir, name);
        if (fs.existsSync(file)) {
            try {
                fs.unlinkSync(file);
            } catch (_error) {
                // Chromium may hold these while another instance is still running.
            }
        }
    }
}

function eventSink(messages) {
    return {
        sender: {
            send(channel, message) {
                messages.push({ channel, message });
            }
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
    removeBrowserLocks(userDataDir);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true
    });

    const messages = [];
    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(7000);

        await ensureSunoAdvancedMode(page, eventSink(messages), { manualTimeoutMs: 3000 });
        await ensureSunoWriteLyricsMode(page, eventSink(messages), { manualTimeoutMs: 3000 });

        const lyricsInput = await firstVisible(page, sunoLyricsInputs(page));
        const styleInput = await firstVisible(page, sunoStyleInputs(page));
        const titleInput = await firstVisible(page, sunoTitleInputs(page));

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const lyrics = `Create 버튼 실제 클릭 확인용 가사입니다. ${stamp}`;
        const style = '아주 빠른 한국의 랩';
        const title = `Create 클릭 확인 ${stamp}`;

        await replaceInputText(page, lyricsInput, lyrics);
        await replaceInputText(page, styleInput, style);
        await replaceInputText(page, titleInput, title);

        const beforeClick = {
            lyrics: await readField(lyricsInput),
            style: await readField(styleInput),
            title: await readField(titleInput),
            cowriterPrompt: await page.locator('textarea[aria-label="Cowriter prompt"]').evaluate((element) => element.value).catch(() => null)
        };

        await clickSunoCreateButton(page);
        await page.waitForTimeout(15000);

        const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
        console.log(JSON.stringify({
            userDataDir,
            beforeClick,
            messages,
            createClicked: true,
            observedTitleAfterClick: bodyText.includes(title),
            bodyTextStart: bodyText.replace(/\s+/g, ' ').slice(0, 1200)
        }, null, 2));
    } finally {
        await context.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
