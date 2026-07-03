const fs = require('fs');
const os = require('os');
const path = require('path');

// Uses the same logged-in session the app saves. The Electron app must be closed
// first, otherwise the persistent-context directory is locked.
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
    await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 90000
    });

    // Wait (up to 3 min) for a manual login: the login form's password field
    // disappears and the logged-in chrome (nav svgs) appears.
    console.log('>>> 브라우저에서 인스타그램에 로그인해주세요. 로그인 감지 후 자동으로 덤프합니다...');
    const loginDeadline = Date.now() + 180000;
    let loggedIn = false;
    while (Date.now() < loginDeadline) {
        loggedIn = await page.evaluate(() => {
            const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
            const svgCount = document.querySelectorAll('svg[aria-label]').length;
            return !hasPasswordField && svgCount > 3;
        }).catch(() => false);
        if (loggedIn) break;
        await page.waitForTimeout(3000);
    }
    console.log(loggedIn ? '>>> 로그인 감지됨. DOM을 덤프합니다.' : '>>> 로그인 타임아웃. 현재 화면을 덤프합니다.');
    await page.waitForTimeout(3000);

    const state = await page.evaluate(() => {
        const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const describe = (element) => {
            const clickable = element.closest('a, [role="link"], [role="button"], div[tabindex]');
            return {
                tag: element.tagName.toLowerCase(),
                ariaLabel: element.getAttribute('aria-label') || '',
                text: (element.textContent || '').trim().slice(0, 40),
                clickableTag: clickable ? clickable.tagName.toLowerCase() : null,
                clickableRole: clickable ? clickable.getAttribute('role') : null,
                clickableHref: clickable ? clickable.getAttribute('href') : null
            };
        };
        return {
            url: location.href,
            title: document.title,
            // Every aria-labelled svg (create button, home, search, etc.)
            svgAriaLabels: Array.from(document.querySelectorAll('svg[aria-label]'))
                .filter(visible)
                .map(describe),
            // Every clickable nav item text
            navClickables: Array.from(document.querySelectorAll('a, [role="link"], [role="button"]'))
                .filter(visible)
                .map((element) => ({
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute('role'),
                    href: element.getAttribute('href'),
                    ariaLabel: element.getAttribute('aria-label') || '',
                    text: (element.textContent || '').trim().slice(0, 40)
                }))
                .filter((item) => item.text || item.ariaLabel)
                .slice(0, 120)
        };
    });

    const stamp = Date.now();
    const jsonPath = path.join(outputDir, `instagram-state-${stamp}.json`);
    const screenshotPath = path.join(outputDir, `instagram-state-${stamp}.png`);
    fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ jsonPath, screenshotPath, ...state }, null, 2));

    // Leave the browser open for 30s so you can watch/interact if needed.
    await page.waitForTimeout(30000);
    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
