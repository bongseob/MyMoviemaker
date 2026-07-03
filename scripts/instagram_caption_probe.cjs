const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');
const videoPath = path.resolve('electron/outputs/videos/20260623.mp4');
const CAPTION = '테스트 캡션입니다 #probe #reels';

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
    const steps = [];
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    await page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await clickByExactText(page, ['게시물', 'Post']);
    await page.waitForTimeout(2500);
    await page.locator('[role="dialog"] input[type="file"], input[type="file"]').first().setInputFiles(videoPath);
    await page.waitForTimeout(4000);
    await clickByExactText(page, ['확인', 'OK']);

    // advance 다음 until caption appears
    for (let i = 0; i < 4; i++) {
        const captionVisible = await page.locator(CAPTION_SELECTORS.join(', ')).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (captionVisible) break;
        const clicked = await clickByExactText(page, ['다음', 'Next']);
        if (!clicked) { await page.waitForTimeout(2000); continue; }
        await page.waitForTimeout(3000);
    }

    const readBack = () => page.evaluate((selectors) => {
        const element = selectors.map((s) => document.querySelector(s)).find(Boolean);
        return element ? { text: (element.innerText || element.value || '').trim(), tag: element.tagName.toLowerCase() } : null;
    }, CAPTION_SELECTORS);

    const caption = page.locator(CAPTION_SELECTORS.join(', ')).first();

    // Method A: real click focus + keyboard.insertText
    await caption.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.insertText(CAPTION + ' [A]');
    await page.waitForTimeout(1200);
    steps.push({ step: 'methodA-click-insertText', value: await readBack() });

    // Clear, then Method B: real click focus + keyboard.type (real key events)
    await caption.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.type(CAPTION + ' [B]', { delay: 15 });
    await page.waitForTimeout(1200);
    steps.push({ step: 'methodB-click-type', value: await readBack() });

    // Dump share button candidates (do NOT click).
    const shareButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[role="button"], button, div[role="button"]'))
            .map((b) => (b.innerText || '').trim())
            .filter((t) => t === '공유하기' || t === '공유' || t.toLowerCase() === 'share');
    });
    steps.push({ step: 'share-buttons', value: shareButtons });

    const stamp = Date.now();
    const screenshotPath = path.join(outputDir, `instagram-caption-${stamp}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    const jsonPath = path.join(outputDir, `instagram-caption-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(steps, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, screenshotPath, steps }, null, 2));

    await page.waitForTimeout(3000);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
