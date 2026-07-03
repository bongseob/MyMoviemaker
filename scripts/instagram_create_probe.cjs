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
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Wait for the feed/sidebar to actually render.
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const result = await page.evaluate(() => {
        // Dump EVERY svg aria-label (no visibility filter) with its clickable ancestor.
        const allSvgs = Array.from(document.querySelectorAll('svg[aria-label]')).map((svg) => {
            const clickable = svg.closest('a, [role="link"], [role="button"], div[tabindex], button');
            return {
                ariaLabel: svg.getAttribute('aria-label') || '',
                clickableTag: clickable ? clickable.tagName.toLowerCase() : null,
                clickableRole: clickable ? clickable.getAttribute('role') : null,
                clickableHref: clickable ? clickable.getAttribute('href') : null,
                clickableTabindex: clickable ? clickable.getAttribute('tabindex') : null
            };
        });

        // Identify the likely create button.
        const createCandidates = allSvgs.filter((item) => {
            const l = item.ariaLabel.toLowerCase();
            return l.includes('만들기') || l.includes('게시물') || l.includes('new post') || l.includes('create');
        });

        return { url: location.href, totalSvgs: allSvgs.length, allSvgLabels: allSvgs, createCandidates };
    });

    const stamp = Date.now();
    const jsonPath = path.join(outputDir, `instagram-create-${stamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ jsonPath, ...result }, null, 2));

    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
