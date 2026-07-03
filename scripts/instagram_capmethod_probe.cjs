const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');
const videoPath = 'C:\\Users\\USER\\Documents\\MyMoviemaker\\videos\\20260703.mp4';
const CAPTION = '커밋 테스트 caption 12345 #diag';

const SEL = '[aria-label*="문구"][contenteditable="true"], div[contenteditable="true"][role="textbox"]';

async function clickByExactText(page, texts) {
    return page.evaluate((wanted) => {
        const nodes = Array.from(document.querySelectorAll('a[role="link"], a, [role="button"], button, div[tabindex]'));
        const target = nodes.find((el) => wanted.includes((el.innerText || '').trim()));
        if (target) { target.click(); return (target.innerText || '').trim(); }
        return null;
    }, texts);
}

function inspect(page) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        return {
            text: (el.innerText || '').trim(),
            html: el.innerHTML.slice(0, 400),
            lexicalSpans: el.querySelectorAll('span[data-lexical-text="true"]').length
        };
    }, SEL);
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
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.instagram.com' }).catch(() => {});
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
        const capVis = await page.locator(SEL).first().isVisible({ timeout: 1000 }).catch(() => false);
        if (capVis) break;
        await clickByExactText(page, ['다음', 'Next']);
        await page.waitForTimeout(3000);
    }

    const cap = page.locator(SEL).first();

    // METHOD 1: keyboard.type
    await cap.click({ timeout: 8000 });
    await page.waitForTimeout(300);
    await page.keyboard.type(CAPTION, { delay: 20 });
    await page.waitForTimeout(800);
    out.afterType = await inspect(page);

    // clear
    await cap.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    out.afterClear = await inspect(page);

    // METHOD 2: clipboard paste
    await page.evaluate((t) => navigator.clipboard.writeText(t), CAPTION).catch((e) => { out.clipErr = String(e).slice(0, 120); });
    await cap.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+V');
    await page.waitForTimeout(1000);
    out.afterPaste = await inspect(page);

    const stamp = Date.now();
    const jsonPath = path.join(outputDir, `instagram-capmethod-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, ...out }, null, 2));

    await page.waitForTimeout(1500);
    await context.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
