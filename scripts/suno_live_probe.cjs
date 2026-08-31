const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { __test } = require('../electron/services/suno.cjs');

chromium.use(stealth);

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'scripts', 'suno_live_probe_output.json');

function candidateUserDataDirs() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return [
        path.join(appData, 'AntigravityMovieMaker', 'suno-playwright-session'),
        path.join(appData, 'mymoviemaker', 'suno-playwright-session'),
        path.join(appData, 'MyMoviemaker', 'suno-playwright-session')
    ];
}

async function visibleSummary(page) {
    return page.evaluate(() => {
        const isVisible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0
                && rect.height > 0
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && Number(style.opacity || '1') > 0;
        };

        const summarize = (element) => ({
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            type: element.getAttribute('type'),
            text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
            ariaLabel: element.getAttribute('aria-label'),
            placeholder: element.getAttribute('placeholder'),
            name: element.getAttribute('name'),
            dataTestId: element.getAttribute('data-testid'),
            className: typeof element.className === 'string' ? element.className.slice(0, 180) : '',
            checked: element.checked,
            ariaChecked: element.getAttribute('aria-checked'),
            ariaPressed: element.getAttribute('aria-pressed')
        });

        const controls = Array.from(document.querySelectorAll([
            'button',
            '[role="button"]',
            '[role="tab"]',
            '[role="switch"]',
            '[aria-pressed]',
            'label',
            'a'
        ].join(',')))
            .filter(isVisible)
            .map(summarize);

        const fields = Array.from(document.querySelectorAll('textarea,input,[contenteditable="true"]'))
            .filter(isVisible)
            .map(summarize);

        return {
            url: location.href,
            title: document.title,
            bodyTextStart: (document.body.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 3000),
            controls,
            fields
        };
    });
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

(async () => {
    const existingDir = candidateUserDataDirs().find((dir) => fs.existsSync(dir));
    const userDataDir = existingDir || candidateUserDataDirs()[0];
    const messages = [];
    const result = {
        userDataDir,
        before: null,
        after: null,
        trackIds: [],
        ensureAdvancedError: null,
        messages
    };

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true
    });

    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(7000);
        result.before = await visibleSummary(page);
        result.trackIds = [...await __test.snapshotSunoTrackIds(page)];

        try {
            await __test.ensureSunoAdvancedMode(page, eventSink(messages), { manualTimeoutMs: 3000 });
        } catch (error) {
            result.ensureAdvancedError = error instanceof Error ? error.message : String(error);
        }

        await page.waitForTimeout(1000);
        result.after = await visibleSummary(page);
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
        console.log(outputPath);
    } finally {
        await context.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
