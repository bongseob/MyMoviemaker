const path = require('path');
const { getErrorMessage } = require('../lib/errors.cjs');
const { VIDEO_EXTENSIONS, assertExistingFile, optionalText } = require('../lib/validation.cjs');

let tiktokBrowserContext = null;

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
                // Keep scanning while TikTok changes the upload page after login.
            }
        }
        await page.waitForTimeout(300);
    }
    throw new Error('Visible TikTok control was not found.');
}

async function maybeFirstVisible(page, locator, timeout = 3000) {
    try {
        return await firstVisible(page, locator, timeout);
    } catch (_e) {
        return null;
    }
}

async function firstAttached(page, locator, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const count = await locator.count();
        if (count > 0) {
            return locator.first();
        }
        await page.waitForTimeout(300);
    }
    throw new Error('TikTok file input was not found.');
}

function tiktokFileInputs(page) {
    return page.locator('input[type="file"]');
}

function tiktokCaptionInputs(page) {
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

function tiktokPostButtons(page) {
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
    const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
    const isContentEditable = await locator.evaluate((element) => element.isContentEditable).catch(() => false);

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
        if (text) {
            await page.keyboard.insertText(text);
        }
        await locator.evaluate((element) => {
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => {});
        return;
    }

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
        return true;
    });

    if (!focused) {
        throw new Error('TikTok 캡션 입력창을 찾지 못했습니다.');
    }

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Backspace').catch(() => {});
    await page.keyboard.insertText(text);
    await page.waitForTimeout(1000);
}

async function waitForUploadPage(page, event) {
    event.sender.send('tiktok-status', 'TikTok 업로드 페이지를 확인합니다. 로그인/인증 화면이 보이면 브라우저에서 직접 완료해주세요.');
    return firstAttached(page, tiktokFileInputs(page), 300000);
}

async function waitForPostButtonReady(page, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const button = await maybeFirstVisible(page, tiktokPostButtons(page), 2000);
        if (button) {
            const disabled = await button.evaluate((element) => {
                return Boolean(element.disabled)
                    || element.getAttribute('aria-disabled') === 'true'
                    || element.closest('[aria-disabled="true"]');
            }).catch(() => false);
            if (!disabled) {
                return button;
            }
        }
        await page.waitForTimeout(1000);
    }
    return null;
}

function normalizeCaption(value) {
    return optionalText(value, 'TikTok caption', 2200).trim();
}

function registerTiktokIpc({ ipcMain, app }) {
    ipcMain.handle('prepare-tiktok-upload', async (event, data = {}) => {
        let context;
        try {
            const videoPath = assertExistingFile(data.videoPath, 'TikTok video file', VIDEO_EXTENSIONS);
            const caption = normalizeCaption(data.caption);
            const autoPost = Boolean(data.autoPost);
            const userDataDir = path.join(app.getPath('userData'), 'tiktok-playwright-session');

            const { chromium } = require('playwright-extra');
            const stealth = require('puppeteer-extra-plugin-stealth')();
            chromium.use(stealth);

            if (tiktokBrowserContext) {
                try {
                    const pages = tiktokBrowserContext.pages();
                    if (pages.length > 0 && !pages[0].isClosed()) {
                        context = tiktokBrowserContext;
                    } else {
                        tiktokBrowserContext = null;
                    }
                } catch (_e) {
                    tiktokBrowserContext = null;
                }
            }

            if (!tiktokBrowserContext) {
                event.sender.send('tiktok-status', 'TikTok 브라우저를 엽니다. 첫 실행이면 로그인 상태를 저장합니다.');
                tiktokBrowserContext = await chromium.launchPersistentContext(userDataDir, {
                    headless: false,
                    viewport: { width: 1366, height: 900 },
                    acceptDownloads: true,
                    args: ['--disable-blink-features=AutomationControlled']
                });
                context = tiktokBrowserContext;
            }

            context = context || tiktokBrowserContext;
            const page = context.pages()[0] || await context.newPage();
            event.sender.send('tiktok-status', 'TikTok 업로드 페이지로 이동합니다.');
            await page.goto('https://www.tiktok.com/tiktokstudio/upload?lang=ko-KR', {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            });
            await page.waitForTimeout(10000);

            const fileInput = await waitForUploadPage(page, event);
            event.sender.send('tiktok-status', '영상 파일을 TikTok 업로드 입력창에 첨부합니다.');
            await fileInput.setInputFiles(videoPath);

            if (caption) {
                event.sender.send('tiktok-status', '캡션을 입력합니다.');
                const captionInput = await maybeFirstVisible(page, tiktokCaptionInputs(page), 60000);
                if (captionInput) {
                    await fillCaptionByDomFocus(page, caption);
                } else {
                    event.sender.send('tiktok-status', '캡션 입력창을 자동으로 찾지 못했습니다. 브라우저에서 직접 입력해주세요.');
                }
            }

            event.sender.send('tiktok-status', 'TikTok 처리 완료와 게시 버튼 활성화를 기다립니다.');
            const postButton = await waitForPostButtonReady(page);

            if (autoPost) {
                if (!postButton) {
                    throw new Error('게시 버튼이 활성화되지 않았습니다. TikTok 브라우저에서 영상 처리 상태와 필수 항목을 확인해주세요.');
                }
                event.sender.send('tiktok-status', '게시 버튼을 클릭합니다.');
                await postButton.click();
                event.sender.send('tiktok-status', '게시 버튼 클릭 완료. TikTok 화면에서 최종 결과를 확인해주세요.');
                return { success: true, message: 'TikTok 게시 버튼 클릭 완료' };
            }

            event.sender.send('tiktok-status', postButton
                ? '업로드 화면 준비 완료. 브라우저에서 내용을 확인한 뒤 게시 버튼을 직접 눌러주세요.'
                : '영상 첨부와 캡션 입력을 시도했습니다. 브라우저에서 처리 상태를 확인한 뒤 게시해주세요.');

            return {
                success: true,
                message: postButton
                    ? 'TikTok 업로드 화면 준비 완료'
                    : 'TikTok 업로드 입력 완료. 브라우저 확인 필요'
            };
        } catch (error) {
            const message = getErrorMessage(error);
            event.sender.send('tiktok-status', `TikTok 업로드 준비 실패: ${message}`);
            return { success: false, error: message };
        }
    });
}

module.exports = { registerTiktokIpc };
