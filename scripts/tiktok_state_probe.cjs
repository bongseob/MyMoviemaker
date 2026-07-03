const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'tiktok-playwright-session');
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
    await page.goto('https://www.tiktok.com/upload?lang=ko-KR', {
        waitUntil: 'domcontentloaded',
        timeout: 90000
    });
    await page.waitForTimeout(10000);

    const state = await page.evaluate(() => {
        const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        return {
            url: location.href,
            title: document.title,
            bodyText: document.body.innerText.slice(0, 3000),
            fileInputCount: document.querySelectorAll('input[type="file"]').length,
            visibleButtonTexts: Array.from(document.querySelectorAll('button, [role="button"], a'))
                .filter(visible)
                .map((element) => (element.innerText || element.getAttribute('aria-label') || '').trim())
                .filter(Boolean)
                .slice(0, 80),
            contentEditableCount: document.querySelectorAll('[contenteditable="true"]').length,
            textareaCount: document.querySelectorAll('textarea').length
        };
    });

    const jsonPath = path.join(outputDir, `tiktok-state-${Date.now()}.json`);
    const screenshotPath = path.join(outputDir, `tiktok-state-${Date.now()}.png`);
    fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ jsonPath, screenshotPath, ...state }, null, 2));
    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
