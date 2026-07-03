const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');
const videoPath = 'C:\\Users\\USER\\Documents\\MyMoviemaker\\videos\\20260703.mp4';
const CAPTION = '진단 캡션 테스트 12345 #diag';

const CAPTION_SELECTORS = [
    '[aria-label*="문구"][contenteditable="true"]',
    '[aria-label*="caption" i][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[aria-label*="문구"]',
    'textarea[aria-label*="caption" i]'
];

async function clickByExactText(page, texts) {
    return page.evaluate((wanted) => {
        const nodes = Array.from(document.querySelectorAll('a[role="link"], a, [role="button"], button, div[tabindex]'));
        const target = nodes.find((el) => wanted.includes((el.innerText || '').trim()));
        if (target) { target.click(); return (target.innerText || '').trim(); }
        return null;
    }, texts);
}

function dumpEditables(page) {
    return page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[contenteditable="true"], textarea'));
        return els.map((e) => ({
            tag: e.tagName.toLowerCase(),
            ariaLabel: e.getAttribute('aria-label') || '',
            role: e.getAttribute('role') || '',
            text: (e.innerText || e.value || '').trim().slice(0, 60),
            len: (e.innerText || e.value || '').trim().length
        }));
    });
}

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, viewport: { width: 1366, height: 900 }, acceptDownloads: true,
        args: ['--disable-blink-features=AutomationControlled']
    });
    const page = context.pages()[0] || await context.newPage();
    const out = {};
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    await page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await clickByExactText(page, ['게시물', 'Post']);
    await page.waitForTimeout(2500);
    await page.locator('[role="dialog"] input[type="file"], input[type="file"]').first().setInputFiles(videoPath);
    await page.waitForTimeout(4000);
    await clickByExactText(page, ['확인', 'OK']);
    for (let i = 0; i < 4; i++) {
        const capVis = await page.locator(CAPTION_SELECTORS.join(', ')).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (capVis) break;
        await clickByExactText(page, ['다음', 'Next']);
        await page.waitForTimeout(3000);
    }

    out.editablesBeforeType = await dumpEditables(page);

    const cap = page.locator(CAPTION_SELECTORS.join(', ')).first();
    await cap.click({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.keyboard.type(CAPTION, { delay: 20 });
    await page.waitForTimeout(1000);
    out.editablesAfterType = await dumpEditables(page);

    // Blur by clicking the dialog heading area (neutral), then re-read.
    await page.locator('[role="dialog"]').first().click({ position: { x: 200, y: 20 } }).catch(() => {});
    await page.waitForTimeout(2000);
    out.editablesAfterBlur = await dumpEditables(page);

    // Is there any hidden input/textarea that mirrors the caption? Dump form fields.
    out.formFields = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, textarea'))
            .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || '', ariaLabel: e.getAttribute('aria-label') || '', value: (e.value || '').slice(0, 60) }))
            .filter((f) => f.type !== 'file');
    });

    const stamp = Date.now();
    const screenshotPath = path.join(outputDir, `instagram-capdiag-${stamp}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    const jsonPath = path.join(outputDir, `instagram-capdiag-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({ screenshotPath, ...out }, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, screenshotPath, ...out }, null, 2));

    // Do NOT share. Close.
    await page.waitForTimeout(2000);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
