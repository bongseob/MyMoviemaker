const path = require('path');
const { getErrorMessage } = require('../lib/errors.cjs');
const { VIDEO_EXTENSIONS, assertExistingFile, optionalText } = require('../lib/validation.cjs');

let instagramBrowserContext = null;

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
                // Keep scanning while Instagram changes the create dialog after login.
            }
        }
        await page.waitForTimeout(300);
    }
    throw new Error('Visible Instagram control was not found.');
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
    throw new Error('Instagram file input was not found.');
}

function instagramCreateButtons(page) {
    // The clickable target is the sidebar link/button that wraps the icon,
    // not the <svg> itself. Instagram's Korean aria-label is "새로운 게시물 만들기",
    // so match by substring rather than exact text.
    return page.locator([
        'a[role="link"]:has(svg[aria-label*="만들기" i])',
        'a[role="link"]:has(svg[aria-label*="게시물" i])',
        'a[role="link"]:has(svg[aria-label*="New post" i])',
        'a[role="link"]:has(svg[aria-label*="Create" i])',
        'div[role="button"]:has(svg[aria-label*="만들기" i])',
        'div[role="button"]:has(svg[aria-label*="게시물" i])',
        'div[role="button"]:has(svg[aria-label*="New post" i])',
        'div[role="button"]:has(svg[aria-label*="Create" i])',
        '[role="link"]:has-text("만들기")',
        '[role="button"]:has-text("만들기")',
        '[role="link"]:has-text("Create")',
        '[role="button"]:has-text("Create")',
        'svg[aria-label*="만들기" i]',
        'svg[aria-label*="New post" i]'
    ].join(', '));
}

// Fallback: find the create control in the DOM by aria-label/text substring and
// click its nearest clickable ancestor. Returns the matched label, or null.
async function clickCreateByAriaLabel(page) {
    return page.evaluate(() => {
        const keywords = ['만들기', '게시물', 'new post', 'create'];
        const clickableSelector = 'a, [role="link"], [role="button"], div[tabindex]';

        const svgs = Array.from(document.querySelectorAll('svg[aria-label]'));
        for (const svg of svgs) {
            const label = (svg.getAttribute('aria-label') || '').toLowerCase();
            if (keywords.some((keyword) => label.includes(keyword))) {
                const clickable = svg.closest(clickableSelector);
                if (clickable) {
                    clickable.click();
                    return label;
                }
            }
        }

        const nodes = Array.from(document.querySelectorAll(clickableSelector));
        for (const node of nodes) {
            const text = (node.textContent || '').trim().toLowerCase();
            if (text === '만들기' || text === 'create') {
                node.click();
                return text;
            }
        }
        return null;
    });
}

// After clicking the create (+) button, Instagram web shows a flyout with items
// like 게시물 / 릴스 / 라이브 방송 / 광고. Clicking via Playwright's :has-text or
// getByRole is unreliable here (it hits a wrapping element and the modal never
// opens); an exact-innerText DOM click on the anchor works. On web, choosing
// 게시물 (Post) with a video produces a Reel, which is the desired path.
async function clickByExactText(page, texts) {
    return page.evaluate((wanted) => {
        const nodes = Array.from(document.querySelectorAll('a[role="link"], a, [role="button"], button, div[tabindex]'));
        const target = nodes.find((element) => wanted.includes((element.innerText || '').trim()));
        if (target) {
            target.click();
            return (target.innerText || '').trim();
        }
        return null;
    }, texts);
}

function instagramFileInputs(page) {
    // The create modal ("새 게시물 만들기") holds the upload input; prefer the
    // dialog-scoped input, falling back to any file input.
    return page.locator('[role="dialog"] input[type="file"], input[type="file"]');
}

function instagramShareButtons(page) {
    return page.locator([
        '[role="button"]:has-text("공유하기")',
        '[role="button"]:has-text("공유")',
        '[role="button"]:has-text("Share")',
        'button:has-text("공유하기")',
        'button:has-text("공유")',
        'button:has-text("Share")',
        'div[role="button"]:has-text("공유")'
    ].join(', '));
}

function instagramCaptionInputs(page) {
    // On the final "새 릴스" screen the caption is a contenteditable div whose
    // aria-label is "문구를 입력하세요...".
    return page.locator([
        '[aria-label*="문구" i][contenteditable="true"]',
        '[aria-label*="caption" i][contenteditable="true"]',
        '[contenteditable="true"][aria-label*="write a caption" i]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="문구" i]',
        'textarea[aria-label*="caption" i]'
    ].join(', '));
}

// Instagram shows a dialog such as "동영상 게시물이 릴스로 공유됩니다" with an OK button.
async function dismissReelInfoDialog(page) {
    const okButtons = page.locator([
        '[role="button"]:has-text("확인")',
        '[role="button"]:has-text("OK")',
        'button:has-text("확인")',
        'button:has-text("OK")'
    ].join(', '));
    const okButton = await maybeFirstVisible(page, okButtons, 3000);
    if (okButton) {
        await okButton.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1000);
    }
}

async function dismissInstagramGuides(page) {
    const dismissButtons = page.locator([
        '[role="button"]:has-text("나중에 하기")',
        '[role="button"]:has-text("Not Now")',
        '[role="button"]:has-text("나중에")',
        'button:has-text("나중에 하기")',
        'button:has-text("Not Now")'
    ].join(', '));
    const dismissButton = await maybeFirstVisible(page, dismissButtons, 1500);
    if (dismissButton) {
        await dismissButton.click({ timeout: 1500 }).catch(() => {});
    }
}

async function fillCaptionByDomFocus(page, text) {
    // Instagram's caption is a Lexical contenteditable. A programmatic element.focus()
    // does NOT arm its input model (inserted text is dropped), so a REAL click is
    // required before typing. Verified via scripts/instagram_caption_probe.cjs.
    const caption = await maybeFirstVisible(page, instagramCaptionInputs(page), 15000);
    if (!caption) {
        throw new Error('Instagram 캡션 입력창을 찾지 못했습니다.');
    }

    await caption.scrollIntoViewIfNeeded().catch(() => {});
    await caption.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    // Use real key events (keydown -> beforeinput -> input). keyboard.insertText does
    // NOT fire beforeinput, so Lexical renders the text in the DOM but never updates
    // its EditorState — the caption then submits EMPTY. Verified against real posts.
    await page.keyboard.type(text, { delay: 12 });
    await page.waitForTimeout(1000);
}

async function isButtonReady(button) {
    return button.evaluate((element) => {
        return !(Boolean(element.disabled)
            || element.getAttribute('aria-disabled') === 'true'
            || element.closest('[aria-disabled="true"]'));
    }).catch(() => true);
}

// Instagram's create flow steps: 자르기(crop) -> 편집(edit) -> 새 릴스(caption/share).
// The video must finish processing before the first 다음 appears, and clicking via
// exact-innerText DOM click is more reliable than :has-text here. Stop once the
// caption field (final "새 릴스" screen) is visible.
async function advanceThroughNextSteps(page, event, maxSteps = 4) {
    for (let step = 0; step < maxSteps; step++) {
        if (await maybeFirstVisible(page, instagramCaptionInputs(page), 1000)) {
            return;
        }
        // Wait (up to 90s) for the next 다음/Next button, accounting for video processing.
        let clicked = null;
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            if (await maybeFirstVisible(page, instagramCaptionInputs(page), 500)) {
                return;
            }
            clicked = await clickByExactText(page, ['다음', 'Next']);
            if (clicked) {
                break;
            }
            await page.waitForTimeout(1500);
        }
        if (!clicked) {
            return;
        }
        event.sender.send('instagram-status', `업로드 단계를 진행합니다. (${step + 1}단계)`);
        await page.waitForTimeout(3000);
    }
}

async function waitForShareButtonReady(page, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const button = await maybeFirstVisible(page, instagramShareButtons(page), 2000);
        if (button && await isButtonReady(button)) {
            return button;
        }
        await page.waitForTimeout(1000);
    }
    return null;
}

// After clicking share, Instagram shows "공유 중입니다"(uploading) and only later
// "회원님의 릴스가 공유되었습니다"(done). Closing/navigating during the upload aborts
// the post, so wait for the SUCCESS text — leaving the compose screen alone is not
// enough (that happens the moment uploading starts).
async function waitForShareComplete(page, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const done = await page.evaluate(() => {
            const bodyText = document.body ? (document.body.innerText || '') : '';
            return /공유되었|공유 완료|공유됨|shared|has been shared/i.test(bodyText);
        }).catch(() => false);
        if (done) {
            return true;
        }
        await page.waitForTimeout(2000);
    }
    return false;
}

function normalizeCaption(value) {
    return optionalText(value, 'Instagram caption', 2200).trim();
}

function registerInstagramIpc({ ipcMain, app }) {
    ipcMain.handle('prepare-instagram-upload', async (event, data = {}) => {
        let context;
        try {
            const videoPath = assertExistingFile(data.videoPath, 'Instagram video file', VIDEO_EXTENSIONS);
            const caption = normalizeCaption(data.caption);
            const autoShare = Boolean(data.autoShare);
            const userDataDir = path.join(app.getPath('userData'), 'instagram-playwright-session');

            const { chromium } = require('playwright-extra');
            const stealth = require('puppeteer-extra-plugin-stealth')();
            chromium.use(stealth);

            if (instagramBrowserContext) {
                try {
                    const pages = instagramBrowserContext.pages();
                    if (pages.length > 0 && !pages[0].isClosed()) {
                        context = instagramBrowserContext;
                    } else {
                        instagramBrowserContext = null;
                    }
                } catch (_e) {
                    instagramBrowserContext = null;
                }
            }

            if (!instagramBrowserContext) {
                event.sender.send('instagram-status', 'Instagram 브라우저를 엽니다. 첫 실행이면 로그인 상태를 저장합니다.');
                instagramBrowserContext = await chromium.launchPersistentContext(userDataDir, {
                    headless: false,
                    viewport: { width: 1366, height: 900 },
                    acceptDownloads: true,
                    args: ['--disable-blink-features=AutomationControlled']
                });
                context = instagramBrowserContext;
            }

            context = context || instagramBrowserContext;
            const page = context.pages()[0] || await context.newPage();
            event.sender.send('instagram-status', 'Instagram 페이지로 이동합니다. 로그인/인증 화면이 보이면 브라우저에서 직접 완료해주세요.');
            await page.goto('https://www.instagram.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            });
            await page.waitForTimeout(8000);
            await dismissInstagramGuides(page);

            event.sender.send('instagram-status', '로그인 완료 후 만들기(새 게시물) 버튼을 찾습니다.');
            // Wait until the create control is present, then click its clickable ancestor.
            const createButton = await maybeFirstVisible(page, instagramCreateButtons(page), 300000);
            if (createButton) {
                await createButton.click({ timeout: 5000 }).catch(() => {});
            } else {
                // Fallback: DOM-level click on the nearest clickable ancestor of the icon.
                const clickedLabel = await clickCreateByAriaLabel(page);
                if (!clickedLabel) {
                    throw new Error('만들기(새 게시물) 버튼을 찾지 못했습니다. Instagram 화면에서 좌측 만들기 버튼을 직접 눌러주세요.');
                }
            }
            await page.waitForTimeout(2000);

            // The create flyout opens with 게시물/릴스/라이브 방송/광고. Choose 게시물
            // (or 릴스 if present) via an exact-innerText DOM click — the reliable path.
            // Skip if a create dialog with a file input is already open.
            const dialogFileInput = await maybeFirstVisible(page, page.locator('[role="dialog"] input[type="file"]'), 2000);
            if (!dialogFileInput) {
                // Use 게시물 (Post) only: a video posted this way becomes a Reel, and
                // unlike "릴스", the exact text "게시물" does not collide with a sidebar
                // nav item (clicking sidebar 릴스 would navigate away to /reels/).
                event.sender.send('instagram-status', '게시물(릴스) 옵션을 선택합니다.');
                const menuLabel = await clickByExactText(page, ['게시물', 'Post']);
                if (!menuLabel) {
                    event.sender.send('instagram-status', '게시물/릴스 옵션을 자동으로 찾지 못했습니다. Instagram 창에서 직접 선택해주세요.');
                }
                await page.waitForTimeout(2500);
            }

            event.sender.send('instagram-status', '영상 파일을 첨부합니다.');
            const fileInput = await firstAttached(page, instagramFileInputs(page), 60000);
            await fileInput.setInputFiles(videoPath);
            await page.waitForTimeout(2000);

            // "동영상 게시물이 릴스로 공유됩니다" 안내 다이얼로그 처리
            await dismissReelInfoDialog(page);

            event.sender.send('instagram-status', '자르기/편집 단계를 진행합니다.');
            await advanceThroughNextSteps(page, event, 3);

            if (caption) {
                event.sender.send('instagram-status', '캡션을 입력합니다.');
                const captionInput = await maybeFirstVisible(page, instagramCaptionInputs(page), 30000);
                if (captionInput) {
                    await fillCaptionByDomFocus(page, caption);
                } else {
                    event.sender.send('instagram-status', '캡션 입력창을 자동으로 찾지 못했습니다. 브라우저에서 직접 입력해주세요.');
                }
            }

            event.sender.send('instagram-status', '공유 버튼 활성화를 기다립니다.');
            const shareButton = await waitForShareButtonReady(page);

            if (autoShare) {
                if (!shareButton) {
                    throw new Error('공유 버튼이 활성화되지 않았습니다. Instagram 브라우저에서 영상 처리 상태와 필수 항목을 확인해주세요.');
                }
                event.sender.send('instagram-status', '공유 버튼을 클릭합니다.');
                // Blur the caption first. Instagram commits the caption value on the
                // field's blur; a DOM element.click() on the share button does NOT blur
                // it (a real mouse click would), so without this the reel posts with an
                // EMPTY caption even though Lexical holds the text. Verified via probes.
                await page.evaluate(() => {
                    const el = document.querySelector('[aria-label*="문구"][contenteditable="true"], div[contenteditable="true"][role="textbox"]');
                    if (el) { el.blur(); }
                    if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
                }).catch(() => {});
                await page.waitForTimeout(800);

                // Reliable DOM exact-text click (:has-text can hit a wrapping element
                // and do nothing); fall back to the located button.
                const sharedLabel = await clickByExactText(page, ['공유하기', 'Share']);
                if (!sharedLabel) {
                    await shareButton.click().catch(() => {});
                }

                const shared = await waitForShareComplete(page, 180000);
                if (shared) {
                    event.sender.send('instagram-status', '릴스가 공유되었습니다. Instagram 화면에서 확인해주세요.');
                    return { success: true, message: 'Instagram 릴스 공유 완료' };
                }
                event.sender.send('instagram-status', '공유 버튼을 눌렀지만 완료 화면을 확인하지 못했습니다. Instagram 창에서 최종 결과를 확인해주세요.');
                return { success: true, message: 'Instagram 공유 클릭 완료(결과 확인 필요)' };
            }

            event.sender.send('instagram-status', shareButton
                ? '업로드 화면 준비 완료. 브라우저에서 내용을 확인한 뒤 공유 버튼을 직접 눌러주세요.'
                : '영상 첨부와 캡션 입력을 시도했습니다. 브라우저에서 처리 상태를 확인한 뒤 공유해주세요.');

            return {
                success: true,
                message: shareButton
                    ? 'Instagram 업로드 화면 준비 완료'
                    : 'Instagram 업로드 입력 완료. 브라우저 확인 필요'
            };
        } catch (error) {
            const message = getErrorMessage(error);
            event.sender.send('instagram-status', `Instagram 업로드 준비 실패: ${message}`);
            return { success: false, error: message };
        }
    });
}

module.exports = { registerInstagramIpc };
