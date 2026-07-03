const fs = require('fs');
const os = require('os');
const path = require('path');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'instagram-playwright-session');
const outputDir = path.resolve('electron/outputs/diagnostics');

async function dumpState(page, label) {
    return page.evaluate((stateLabel) => {
        const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        return {
            label: stateLabel,
            url: location.href,
            dialogCount: document.querySelectorAll('[role="dialog"]').length,
            dialogText: Array.from(document.querySelectorAll('[role="dialog"]'))
                .map((d) => (d.innerText || '').trim().slice(0, 300)),
            fileInputCount: document.querySelectorAll('input[type="file"]').length,
            menuItems: Array.from(document.querySelectorAll('[role="menuitem"], [role="dialog"] [role="button"]'))
                .filter(visible)
                .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
                .filter(Boolean)
                .slice(0, 40),
            buttonsWithText: Array.from(document.querySelectorAll('[role="dialog"] a, [role="dialog"] [role="button"], [role="dialog"] button'))
                .filter(visible)
                .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
                .filter(Boolean)
                .slice(0, 40)
        };
    }, label);
}

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
    await page.waitForSelector('svg[aria-label]', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // Dismiss post-login interstitials ("정보 저장", "알림 켜기") if present.
    const notNow = page.locator([
        '[role="button"]:has-text("나중에 하기")',
        '[role="button"]:has-text("Not Now")',
        'button:has-text("나중에 하기")',
        'button:has-text("Not Now")'
    ].join(', '));
    for (let i = 0; i < 3; i++) {
        if (await notNow.first().isVisible({ timeout: 2000 }).catch(() => false)) {
            await notNow.first().click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(1500);
        }
    }

    const steps = [];
    steps.push(await dumpState(page, 'before-create-click'));

    // Click the create button using the ground-truth selector.
    const createLocator = page.locator('a[role="link"]:has(svg[aria-label="새로운 게시물"])').first();
    const found = await createLocator.isVisible({ timeout: 5000 }).catch(() => false);
    steps.push({ label: 'create-button-visible', value: found });
    if (found) {
        await createLocator.click({ timeout: 5000 }).catch((e) => steps.push({ label: 'click-error', value: String(e) }));
        await page.waitForTimeout(3000);
    }
    steps.push(await dumpState(page, 'after-create-click'));

    // Dump the create flyout items (게시물 / 라이브 방송 / 광고) with exact tags.
    const flyoutItems = await page.evaluate(() => {
        const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        const wanted = ['게시물', '릴스', '라이브 방송', '광고', 'post', 'reel'];
        return Array.from(document.querySelectorAll('a, [role="link"], [role="button"], div[tabindex], span'))
            .filter(visible)
            .map((el) => {
                const clickable = el.closest('a, [role="link"], [role="button"], div[tabindex]');
                return {
                    text: (el.innerText || '').trim(),
                    tag: el.tagName.toLowerCase(),
                    clickableTag: clickable ? clickable.tagName.toLowerCase() : null,
                    clickableRole: clickable ? clickable.getAttribute('role') : null
                };
            })
            .filter((item) => wanted.some((w) => item.text.toLowerCase() === w));
    });
    steps.push({ label: 'flyout-items', value: flyoutItems });

    // Click the 게시물 (Post) option — this is the reel path on web.
    const postOption = page.locator('a:has-text("게시물"), [role="link"]:has-text("게시물"), div[role="button"]:has-text("게시물"), span:has-text("게시물")').first();
    const postVisible = await postOption.isVisible({ timeout: 3000 }).catch(() => false);
    steps.push({ label: 'post-option-visible', value: postVisible });
    if (postVisible) {
        await postOption.click({ timeout: 5000 }).catch((e) => steps.push({ label: 'post-click-error', value: String(e) }));
        await page.waitForTimeout(3000);
    }
    steps.push(await dumpState(page, 'after-post-click'));

    // Look for the "컴퓨터에서 선택" button and any file input.
    const selectButtonVisible = await page.locator('[role="dialog"] button:has-text("컴퓨터에서 선택"), button:has-text("컴퓨터에서 선택"), [role="button"]:has-text("컴퓨터에서 선택")').first().isVisible({ timeout: 3000 }).catch(() => false);
    steps.push({ label: 'select-from-computer-visible', value: selectButtonVisible });

    const stamp = Date.now();
    const jsonPath = path.join(outputDir, `instagram-click-${stamp}.json`);
    const screenshotPath = path.join(outputDir, `instagram-click-${stamp}.png`);
    fs.writeFileSync(jsonPath, JSON.stringify(steps, null, 2), 'utf8');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.log(JSON.stringify({ jsonPath, screenshotPath, steps }, null, 2));

    await page.waitForTimeout(4000);
    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
