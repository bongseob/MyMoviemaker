const fs = require('fs');
const os = require('os');
const path = require('path');

const videoPath = path.resolve('electron/outputs/videos/20260623.mp4');
const articlePath = path.resolve('electron/outputs/articles/article_2026-06-23_0055.json');
const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mymoviemaker', 'tiktok-playwright-session');

function assertFile(filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`File not found: ${filePath}`);
    }
}

async function firstVisible(page, locator, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const count = await locator.count();
        for (let i = 0; i < count; i++) {
            const candidate = locator.nth(i);
            try {
                if (await candidate.isVisible({ timeout: 500 })) {
                    return candidate;
                }
            } catch (_e) {
                // TikTok mutates the upload page heavily while loading.
            }
        }
        await page.waitForTimeout(300);
    }
    throw new Error('Visible TikTok control was not found.');
}

async function firstAttached(page, locator, timeout = 300000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await locator.count() > 0) {
            return locator.first();
        }
        await page.waitForTimeout(300);
    }
    throw new Error('TikTok file input was not found.');
}

async function maybeFirstVisible(page, locator, timeout = 3000) {
    try {
        return await firstVisible(page, locator, timeout);
    } catch (_e) {
        return null;
    }
}

function captionInputs(page) {
    return page.locator([
        '[data-e2e="caption-textarea"]',
        '[data-e2e*="caption" i] [contenteditable="true"]',
        '[contenteditable="true"][aria-label*="caption" i]',
        '[contenteditable="true"][aria-label*="description" i]',
        '[contenteditable="true"][role="textbox"]',
        'textarea[placeholder*="caption" i]',
        'textarea[placeholder*="description" i]',
        'textarea'
    ].join(', '));
}

function postButtons(page) {
    return page.locator([
        'button[data-e2e="post_video_button"]',
        'button:has-text("Post")',
        'button:has-text("Publish")',
        'button:has-text("게시")',
        'button:has-text("업로드")'
    ].join(', '));
}

async function dismissTiktokGuides(page) {
    await page.evaluate(() => {
        document.querySelectorAll('#react-joyride-portal, [data-test-id="overlay"], .react-joyride__overlay')
            .forEach((element) => element.remove());
    }).catch(() => {});

    const closeButtons = page.locator([
        'button[aria-label*="close" i]',
        'button[aria-label*="닫기" i]',
        'button:has-text("Skip")',
        'button:has-text("건너뛰기")',
        'button:has-text("나중에")',
        'button:has-text("확인")'
    ].join(', '));
    const closeButton = await maybeFirstVisible(page, closeButtons, 1000);
    if (closeButton) {
        await closeButton.click({ timeout: 1000 }).catch(() => {});
    }
}

async function replaceInputText(page, locator, text) {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const isContentEditable = await locator.evaluate((element) => element.isContentEditable).catch(() => false);
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');

    if (isContentEditable || tagName !== 'textarea') {
        await dismissTiktokGuides(page);
        await locator.evaluate((element) => {
            element.focus();
            const selection = window.getSelection();
            if (!selection) return;
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);
        });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await page.keyboard.insertText(text);
        await locator.evaluate((element) => {
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => {});
        return;
    }

    await dismissTiktokGuides(page);
    await locator.fill(text);
}

async function fillCaptionByDomFocus(page, text) {
    await dismissTiktokGuides(page);
    const focused = await page.evaluate(() => {
        const selectors = [
            '[data-e2e="caption-textarea"]',
            '[data-e2e*="caption" i] [contenteditable="true"]',
            '[contenteditable="true"][aria-label*="caption" i]',
            '[contenteditable="true"][aria-label*="description" i]',
            '[contenteditable="true"][role="combobox"]',
            '[contenteditable="true"][role="textbox"]',
            '.public-DraftEditor-content[contenteditable="true"]',
            'textarea[placeholder*="caption" i]',
            'textarea[placeholder*="description" i]',
            'textarea'
        ];
        const element = selectors
            .map((selector) => document.querySelector(selector))
            .find(Boolean);

        if (!element) return null;

        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        element.focus();
        const selection = window.getSelection();
        if (selection && element.isContentEditable) {
            const range = document.createRange();
            range.selectNodeContents(element);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return {
            tagName: element.tagName,
            role: element.getAttribute('role'),
            className: element.className,
            contentEditable: element.getAttribute('contenteditable'),
            ariaLabel: element.getAttribute('aria-label')
        };
    });

    if (!focused) {
        throw new Error('Caption input was not found by DOM focus fallback.');
    }

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(text);
    await page.waitForTimeout(1000);
    return focused;
}

async function waitForPostButtonReady(page, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const button = await maybeFirstVisible(page, postButtons(page), 2000);
        if (button) {
            const disabled = await button.evaluate((element) => {
                return Boolean(element.disabled)
                    || element.getAttribute('aria-disabled') === 'true'
                    || element.closest('[aria-disabled="true"]');
            }).catch(() => false);
            if (!disabled) {
                return true;
            }
        }
        await page.waitForTimeout(1000);
    }
    return false;
}

async function main() {
    assertFile(videoPath);
    assertFile(articlePath);

    const article = JSON.parse(fs.readFileSync(articlePath, 'utf8'));
    const caption = `${article.summary.trim()}\n\n${article.hashtags.join(' ')}`.slice(0, 2200);

    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1366, height: 900 },
        acceptDownloads: true,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    console.log('Opening TikTok upload page...');
    await page.goto('https://www.tiktok.com/tiktokstudio/upload?lang=ko-KR', {
        waitUntil: 'domcontentloaded',
        timeout: 90000
    });
    await page.waitForTimeout(10000);

    console.log('Waiting for file input. Complete login/captcha in the opened browser if needed.');
    const fileInput = await firstAttached(page, page.locator('input[type="file"]'), 300000);
    console.log(`Attaching video: ${videoPath}`);
    await fileInput.setInputFiles(videoPath);

    console.log('Waiting for caption input...');
    await firstVisible(page, captionInputs(page), 90000);
    console.log('Filling caption...');
    const focusedCaption = await fillCaptionByDomFocus(page, caption);

    const ready = await waitForPostButtonReady(page, 180000);
    console.log(JSON.stringify({
        videoPath,
        articlePath,
        captionLength: caption.length,
        caption,
        focusedCaption,
        postButtonReady: ready,
        note: 'Final TikTok post button was not clicked.'
    }, null, 2));
    await context.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
