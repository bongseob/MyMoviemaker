const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');
const videoPath = 'C:\\Users\\USER\\Documents\\MyMoviemaker\\videos\\20260703.mp4';
const captionPath = process.argv[2];

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
    if (!fs.existsSync(videoPath)) throw new Error('video not found: ' + videoPath);
    const caption = fs.readFileSync(captionPath, 'utf8').replace(/\r\n/g, '\n').trim();
    console.log('caption length:', caption.length);

    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, viewport: { width: 1366, height: 900 }, acceptDownloads: true,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    const log = [];
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    await page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    log.push({ step: 'menu', value: await clickByExactText(page, ['게시물', 'Post']) });
    await page.waitForTimeout(2500);

    await page.locator('[role="dialog"] input[type="file"], input[type="file"]').first().setInputFiles(videoPath);
    await page.waitForTimeout(4000);
    await clickByExactText(page, ['확인', 'OK']);

    // advance 다음 until caption appears
    for (let i = 0; i < 4; i++) {
        const captionVisible = await page.locator(CAPTION_SELECTORS.join(', ')).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (captionVisible) break;
        const clicked = await clickByExactText(page, ['다음', 'Next']);
        log.push({ step: `next-${i + 1}`, value: clicked });
        await page.waitForTimeout(3000);
    }

    // Fill caption with the FIXED method: real click + keyboard.type (fires beforeinput).
    const caption_loc = page.locator(CAPTION_SELECTORS.join(', ')).first();
    await caption_loc.click({ timeout: 8000 });
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.keyboard.type(caption, { delay: 8 });
    await page.waitForTimeout(1500);

    const beforeShare = await page.evaluate((sel) => {
        const el = sel.map((s) => document.querySelector(s)).find(Boolean);
        return el ? (el.innerText || el.value || '').trim() : null;
    }, CAPTION_SELECTORS);
    log.push({ step: 'caption-in-field-len', value: beforeShare ? beforeShare.length : 0 });

    // Blur the caption so Instagram commits its value (a DOM click on 공유하기 does not
    // blur the field; without this the caption submits empty).
    await page.evaluate(() => {
        const el = document.querySelector('[aria-label*="문구"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');
        if (el) { el.blur(); }
        if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    }).catch(() => {});
    await page.waitForTimeout(800);

    // SHARE (real post)
    const shared = await clickByExactText(page, ['공유하기', 'Share']);
    log.push({ step: 'share-clicked', value: shared });

    // Wait for the UPLOAD to actually finish ("공유되었습니다"), not just for the
    // compose screen to close. Closing during "공유 중입니다" aborts the post.
    let done = false;
    for (let i = 0; i < 90; i++) {
        done = await page.evaluate(() => /공유되었|공유 완료|공유됨|shared/i.test(document.body.innerText || '')).catch(() => false);
        if (done) break;
        await page.waitForTimeout(2000);
    }
    log.push({ step: 'share-complete-text', value: done });
    // Extra settle time so the media fully commits server-side before we navigate.
    await page.waitForTimeout(12000);

    const shareScreenshot = path.join(outputDir, `instagram-publish-share-${Date.now()}.png`);
    await page.screenshot({ path: shareScreenshot }).catch(() => {});

    // Verify: open the newest reel on the profile and read its caption.
    let publishedCaption = null;
    let verifyScreenshot = null;
    try {
        await page.goto('https://www.instagram.com/dmaker3015/reels/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(6000);
        const firstReel = page.locator('a[href*="/reel/"]').first();
        if (await firstReel.isVisible({ timeout: 8000 }).catch(() => false)) {
            await firstReel.click().catch(() => {});
            await page.waitForTimeout(6000);
            verifyScreenshot = path.join(outputDir, `instagram-publish-verify-${Date.now()}.png`);
            await page.screenshot({ path: verifyScreenshot }).catch(() => {});
            publishedCaption = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]') || document.body;
                return (dialog.innerText || '').slice(0, 800);
            });
        }
    } catch (e) {
        log.push({ step: 'verify-error', value: String(e).slice(0, 200) });
    }

    const result = { log, captionLength: caption.length, beforeShareLength: beforeShare ? beforeShare.length : 0, shareScreenshot, verifyScreenshot, publishedCaptionExcerpt: publishedCaption };
    const jsonPath = path.join(outputDir, `instagram-publish-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, ...result }, null, 2));

    await page.waitForTimeout(3000);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
