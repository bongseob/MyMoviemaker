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
        headless: false,
        viewport: { width: 1366, height: 900 },
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    const steps = [];
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // 1. Open the create flyout.
    await page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first().click({ timeout: 5000 }).catch((e) => steps.push({ step: 'create-click', error: String(e) }));
    await page.waitForTimeout(2000);

    // 2. Click 게시물 via role=link exact name.
    let clicked = false;
    try {
        await page.getByRole('link', { name: '게시물', exact: true }).first().click({ timeout: 5000 });
        clicked = true;
        steps.push({ step: 'post-click', method: 'getByRole link exact' });
    } catch (e) {
        steps.push({ step: 'post-click-getByRole-failed', error: String(e).slice(0, 200) });
    }
    if (!clicked) {
        // Fallback: DOM click on the anchor whose trimmed text is exactly 게시물.
        const domClicked = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[role="link"], a'));
            const target = links.find((a) => (a.innerText || '').trim() === '게시물');
            if (target) { target.click(); return true; }
            return false;
        });
        steps.push({ step: 'post-click-dom-fallback', value: domClicked });
    }

    await page.waitForTimeout(5000);

    // 3. Dump the create dialog.
    const dialogState = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return {
            url: location.href,
            dialogCount: document.querySelectorAll('[role="dialog"]').length,
            fileInputCount: document.querySelectorAll('input[type="file"]').length,
            dialogHeading: dialog ? (dialog.querySelector('h1, h2, [role="heading"]')?.innerText || '').trim() : null,
            dialogText: dialog ? (dialog.innerText || '').trim().slice(0, 400) : null,
            dialogButtons: dialog ? Array.from(dialog.querySelectorAll('button, [role="button"]')).map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 20) : []
        };
    });
    steps.push({ step: 'dialog-state', value: dialogState });

    const stamp = Date.now();
    const jsonPath = path.join(outputDir, `instagram-post-${stamp}.json`);
    const screenshotPath = path.join(outputDir, `instagram-post-${stamp}.png`);
    fs.writeFileSync(jsonPath, JSON.stringify(steps, null, 2), 'utf8');
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    console.log(JSON.stringify({ jsonPath, screenshotPath, steps }, null, 2));

    await page.waitForTimeout(3000);
    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
