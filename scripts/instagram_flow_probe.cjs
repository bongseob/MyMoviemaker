const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');
const videoPath = path.resolve('electron/outputs/videos/20260623.mp4');

async function dumpDialog(page, label) {
    const state = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return {
            heading: dialog ? (dialog.querySelector('h1, h2, [role="heading"]')?.innerText || '').trim() : null,
            text: dialog ? (dialog.innerText || '').trim().slice(0, 200) : null,
            buttons: dialog ? Array.from(dialog.querySelectorAll('button, [role="button"], div[role="button"]'))
                .map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 25) : [],
            captionEditable: dialog ? dialog.querySelectorAll('[contenteditable="true"]').length : 0,
            captionAriaLabels: dialog ? Array.from(dialog.querySelectorAll('[contenteditable="true"], textarea'))
                .map((e) => e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').filter(Boolean) : []
        };
    });
    return { label, ...state };
}

async function clickByExactText(page, texts) {
    return page.evaluate((wanted) => {
        const nodes = Array.from(document.querySelectorAll('a[role="link"], a, [role="button"], div[role="button"], button, div[tabindex]'));
        const target = nodes.find((el) => wanted.includes((el.innerText || '').trim()));
        if (target) { target.click(); return (target.innerText || '').trim(); }
        return null;
    }, texts);
}

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    if (!fs.existsSync(videoPath)) throw new Error('test video not found: ' + videoPath);

    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, viewport: { width: 1366, height: 900 }, acceptDownloads: true,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    const steps = [];
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // create
    await page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
    // 게시물
    const menu = await clickByExactText(page, ['게시물', 'Post']);
    steps.push({ step: 'menu-clicked', value: menu });
    await page.waitForTimeout(2500);
    steps.push(await dumpDialog(page, 'after-menu'));

    // attach video
    const fileInput = page.locator('[role="dialog"] input[type="file"], input[type="file"]').first();
    await fileInput.setInputFiles(videoPath);
    await page.waitForTimeout(4000);
    steps.push(await dumpDialog(page, 'after-file'));

    // handle "동영상은 릴스로 공유됩니다" OK dialog if present
    const okClicked = await clickByExactText(page, ['확인', 'OK']);
    steps.push({ step: 'ok-clicked', value: okClicked });
    await page.waitForTimeout(2500);
    steps.push(await dumpDialog(page, 'after-ok'));

    // step through 다음 / Next up to 3 times
    for (let i = 0; i < 3; i++) {
        const nextClicked = await clickByExactText(page, ['다음', 'Next']);
        steps.push({ step: `next-${i + 1}`, value: nextClicked });
        if (!nextClicked) break;
        await page.waitForTimeout(3000);
        steps.push(await dumpDialog(page, `after-next-${i + 1}`));
    }

    const stamp = Date.now();
    const screenshotPath = path.join(outputDir, `instagram-flow-${stamp}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    const jsonPath = path.join(outputDir, `instagram-flow-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(steps, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, screenshotPath, steps }, null, 2));

    // Leave open briefly, then close WITHOUT sharing.
    await page.waitForTimeout(3000);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
