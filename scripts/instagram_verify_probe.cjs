const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, viewport: { width: 1366, height: 900 },
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.instagram.com/dmaker3015/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);

    // Open the first (newest) post in the profile grid.
    const firstPost = page.locator('a[href*="/p/"], a[href*="/reel/"]').first();
    await firstPost.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const info = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]') || document.body;
        const time = dialog.querySelector('time');
        return {
            url: location.href,
            timeText: time ? (time.getAttribute('datetime') || time.innerText) : null,
            dialogText: (dialog.innerText || '').slice(0, 1200)
        };
    });

    const stamp = Date.now();
    const screenshotPath = path.join(outputDir, `instagram-verify2-${stamp}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    const jsonPath = path.join(outputDir, `instagram-verify2-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ screenshotPath, ...info }, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, screenshotPath, ...info }, null, 2));

    await page.waitForTimeout(2000);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
