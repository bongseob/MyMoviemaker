const path = require('path');
const { getErrorMessage } = require('../lib/errors.cjs');
const { getOutputDir } = require('../lib/paths.cjs');
const { assertArticleData, assertText } = require('../lib/validation.cjs');

// Suno AI Song Generation
let sunoBrowserContext = null;

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
                // Keep scanning while the page is changing after login/navigation.
            }
        }
        await page.waitForTimeout(250);
    }
    throw new Error('Visible Suno input was not found.');
}

async function hasVisible(page, locator, timeout = 1500) {
    try {
        await firstVisible(page, locator, timeout);
        return true;
    } catch (_e) {
        return false;
    }
}

function sunoLyricsInputs(page) {
    return page.locator([
        '[contenteditable="true"][aria-label*="Lyrics" i]',
        '[contenteditable="true"][aria-label*="가사" i]',
        '.lyrics-editor-content[contenteditable="true"]',
        '[data-testid*="lyrics-wrapper" i] textarea',
        '[data-testid*="lyrics" i] textarea',
        '[data-testid="lyrics-textarea"]',
        '[data-testid="lyrics-input-textarea"]',
        'textarea[name*="lyrics" i]',
        'textarea[aria-label*="lyrics" i]',
        'textarea[aria-label*="가사" i]',
        'textarea[placeholder*="enter lyrics" i]',
        'textarea[placeholder*="own lyrics" i]',
        'textarea[placeholder*="write your rhymes" i]',
        'textarea[placeholder*="write your lyrics" i]',
        'textarea[placeholder*="가사" i]',
        'textarea[placeholder*="직접" i]'
    ].join(', '));
}

function sunoWriteLyricsControls(page) {
    return page.locator([
        'button[role="radio"]:has-text("Write")',
        'button:has-text("Write Lyrics")',
        '[role="button"]:has-text("Write Lyrics")',
        'label:has-text("Write Lyrics")',
        'button:has-text("Enter Lyrics")',
        '[role="button"]:has-text("Enter Lyrics")',
        'label:has-text("Enter Lyrics")',
        'button:has-text("My Lyrics")',
        '[role="button"]:has-text("My Lyrics")',
        'label:has-text("My Lyrics")',
        'button:has-text("직접")',
        '[role="button"]:has-text("직접")',
        'label:has-text("직접")',
        'button:has-text("가사 쓰기")',
        '[role="button"]:has-text("가사 쓰기")',
        'label:has-text("가사 쓰기")'
    ].join(', '));
}

function sunoStyleInputs(page) {
    return page.locator([
        '[data-testid*="styles-wrapper" i] textarea',
        '[data-testid*="style" i] textarea',
        '[data-testid="tag-input-textarea"]',
        'textarea[name*="style" i]',
        '[placeholder="Style of Music" i]',
        'textarea[placeholder*="describe a style" i]',
        'textarea[placeholder*="style of music" i]',
        'textarea[placeholder*="math rock" i]',
        'textarea[placeholder*="mandarin" i]',
        'textarea[placeholder*="love ballad" i]',
        '[placeholder="음악 스타일" i]',
        'textarea[placeholder*="또렷한" i]',
        'textarea[placeholder*="orchestra" i]',
        'textarea[placeholder*="style" i]',
        'textarea[placeholder*="스타일" i]',
        'textarea[placeholder*="장르" i]',
        'textarea[placeholder*="스타일" i]',
        'textarea[placeholder*="인트로" i]',
        'textarea[aria-label*="Style" i]',
        'textarea[aria-label*="스타일" i]',
        'textarea[aria-label*="장르" i]',
        'textarea[aria-label*="스타일" i]',
        'textarea:not([aria-label*="Cowriter" i]):not([data-testid="lyrics-textarea"]):not([data-testid="lyrics-input-textarea"]):not([placeholder*="lyrics" i]):not([placeholder*="가사" i]):not([placeholder*="write your rhymes" i]):not([placeholder*="Chat to make music" i])'
    ].join(', '));
}

function sunoTitleInputs(page) {
    return page.locator([
        '[data-testid*="title-wrapper" i] input',
        '[data-testid*="title" i] input',
        'input[data-testid="title-input-textarea"]',
        'input[name*="title" i]',
        'input[aria-label*="title" i]',
        'input[aria-label*="제목" i]',
        'input[placeholder*="Song Title" i]',
        'input[placeholder*="title" i]',
        'input[placeholder*="제목" i]'
    ].join(', '));
}

function sunoSignInControls(page) {
    return page.locator([
        'button:has-text("Sign In")',
        'button:has-text("Log In")',
        'a:has-text("Sign In")',
        'a:has-text("Log In")',
        'button:has-text("로그인")',
        'a:has-text("로그인")'
    ].join(', '));
}

async function closeSunoCookieBanner(page) {
    try {
        const cookieBtn = page.locator('button:has-text("Accept All Cookies"), button:has-text("동의"), button#onetrust-accept-btn-handler').first();
        if (await cookieBtn.isVisible({ timeout: 1500 })) {
            await cookieBtn.click();
            await page.waitForTimeout(500);
        }
    } catch (_e) {
        // Cookie banners vary by locale and are optional.
    }
}

async function clickVisibleTextControl(page, pattern) {
    const clicked = await page.evaluate((source) => {
        const regex = new RegExp(source, 'i');
        const selectors = [
            'button',
            '[role="button"]',
            '[role="tab"]',
            '[role="switch"]',
            '[aria-pressed]',
            'label',
            'a'
        ];
        const elements = Array.from(document.querySelectorAll(selectors.join(',')));
        const target = elements.find((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const text = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`;
            return rect.width > 0
                && rect.height > 0
                && style.visibility !== 'hidden'
                && style.display !== 'none'
                && regex.test(text);
        });

        if (!target) return false;
        target.click();
        return true;
    }, pattern.source);

    return clicked;
}

async function waitForSunoLogin(page, event) {
    const createInputs = page.locator('textarea[placeholder="Chat to make music" i], button:has-text("Advanced"), [data-testid="lyrics-textarea"], [data-testid="lyrics-input-textarea"]');

    try {
        await firstVisible(page, createInputs, 300000);
    } catch (_e) {
        throw new Error('시간 초과: 로그인이 완료되지 않았거나 Suno Create 화면 로딩에 실패했습니다.');
    }

    if (!(await hasVisible(page, sunoSignInControls(page), 1500))) {
        return;
    }

    event.sender.send('suno-status', 'Suno 로그인이 필요합니다. 열린 브라우저에서 로그인한 뒤 Create 화면이 다시 보일 때까지 기다려주세요.');

    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
        await closeSunoCookieBanner(page);
        if (!(await hasVisible(page, sunoSignInControls(page), 1000)) && await hasVisible(page, createInputs, 1000)) {
            return;
        }
        await page.waitForTimeout(1000);
    }

    throw new Error('시간 초과: Suno 로그인이 완료되지 않았습니다.');
}

async function ensureSunoAdvancedMode(page, event, options = {}) {
    const lyricsInputs = sunoLyricsInputs(page);
    const styleInputs = sunoStyleInputs(page);
    const writeLyricsControls = sunoWriteLyricsControls(page);
    const manualTimeoutMs = options.manualTimeoutMs ?? 120000;

    if (await hasVisible(page, styleInputs, 2000)
        && (await hasVisible(page, lyricsInputs, 500) || await hasVisible(page, writeLyricsControls, 500))) {
        return;
    }

    const advancedControls = page.locator([
        'button:has-text("Advanced")',
        '[role="button"]:has-text("Advanced")',
        '[role="tab"]:has-text("Advanced")',
        'label:has-text("Advanced")',
        'button:has-text("Custom")',
        '[role="button"]:has-text("Custom")',
        '[role="tab"]:has-text("Custom")',
        'label:has-text("Custom")',
        'button:has-text("Lyrics")',
        '[role="button"]:has-text("Lyrics")',
        '[role="tab"]:has-text("Lyrics")',
        'label:has-text("Lyrics")',
        'button:has-text("Write Lyrics")',
        '[role="button"]:has-text("Write Lyrics")',
        '[role="tab"]:has-text("Write Lyrics")',
        'label:has-text("Write Lyrics")',
        'button:has-text("Full Song")',
        '[role="button"]:has-text("Full Song")',
        'button:has-text("Song")',
        '[role="button"]:has-text("Song")',
        'button:has-text("고급")',
        '[role="button"]:has-text("고급")',
        '[role="tab"]:has-text("고급")',
        'label:has-text("고급")',
        'button:has-text("커스텀")',
        '[role="button"]:has-text("커스텀")',
        '[role="tab"]:has-text("커스텀")',
        'label:has-text("커스텀")'
    ].join(', '));

    const count = await advancedControls.count();
    for (let i = 0; i < count; i++) {
        const control = advancedControls.nth(i);
        try {
            if (!(await control.isVisible({ timeout: 500 }))) continue;
            await control.scrollIntoViewIfNeeded();
            await control.click({ force: true });
            await page.waitForTimeout(1200);

            if (await hasVisible(page, styleInputs, 2500)
                && (await hasVisible(page, lyricsInputs, 500) || await hasVisible(page, writeLyricsControls, 500))) {
                return;
            }
        } catch (e) {
            console.log('Advanced mode control click failed:', e.message);
        }
    }

    const clickedByText = await clickVisibleTextControl(page, /advanced|custom|lyrics|write lyrics|full song|song|고급|커스텀|맞춤|가사/);
    if (clickedByText) {
        await page.waitForTimeout(1500);
        if (await hasVisible(page, styleInputs, 3000)
            && (await hasVisible(page, lyricsInputs, 500) || await hasVisible(page, writeLyricsControls, 500))) {
            return;
        }
    }

    event.sender.send('suno-status', 'Advanced/Custom 또는 Lyrics 입력 모드를 자동으로 찾지 못했습니다. Suno 창에서 가사와 스타일 입력창이 보이도록 직접 선택해주세요.');
    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
        if (await hasVisible(page, styleInputs, 1000)
            && (await hasVisible(page, lyricsInputs, 500) || await hasVisible(page, writeLyricsControls, 500))) {
            return;
        }
        await page.waitForTimeout(1000);
    }

    throw new Error('Suno Advanced/Custom mode was not enabled, so lyrics/style inputs were not found.');
}

async function ensureSunoWriteLyricsMode(page, event, options = {}) {
    const ownLyricsInput = sunoLyricsInputs(page);
    const manualTimeoutMs = options.manualTimeoutMs ?? 120000;

    if (await hasVisible(page, ownLyricsInput, 1500)) {
        return;
    }

    const writeLyricsControls = sunoWriteLyricsControls(page);

    const count = await writeLyricsControls.count();
    for (let i = 0; i < count; i++) {
        const control = writeLyricsControls.nth(i);
        try {
            if (!(await control.isVisible({ timeout: 500 }))) continue;
            await control.scrollIntoViewIfNeeded();
            await control.click({ force: true });
            await page.waitForTimeout(800);

            if (await hasVisible(page, ownLyricsInput, 2500)) {
                return;
            }
        } catch (e) {
            console.log('Write Lyrics mode control click failed:', e.message);
        }
    }

    // Suno's current radio group can ignore synthetic pointer clicks. Moving
    // left from the selected Prompt radio reliably selects Write.
    const promptControl = page.locator('button[role="radio"]:has-text("Prompt")[aria-checked="true"]').first();
    if (await promptControl.isVisible({ timeout: 1000 }).catch(() => false)) {
        await promptControl.focus();
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(1000);
        if (await hasVisible(page, ownLyricsInput, 2500)) {
            return;
        }
    }

    const clickedByText = await clickVisibleTextControl(page, /write lyrics|enter lyrics|my lyrics|^write$|manual|직접|가사 쓰기|수동/);
    if (clickedByText) {
        await page.waitForTimeout(1000);
        if (await hasVisible(page, ownLyricsInput, 2500)) {
            return;
        }
    }

    event.sender.send('suno-status', 'Write Lyrics 모드를 자동으로 찾지 못했습니다. Suno 창에서 직접 가사 입력 모드를 선택해주세요.');
    const deadline = Date.now() + manualTimeoutMs;
    while (Date.now() < deadline) {
        if (await hasVisible(page, ownLyricsInput, 1000)) {
            return;
        }
        await page.waitForTimeout(1000);
    }

    throw new Error('Suno Write Lyrics mode was not enabled, so the direct lyrics input was not found.');
}

async function replaceInputText(page, locator, value) {
    await locator.scrollIntoViewIfNeeded();
    const isEditable = await locator.evaluate((element) => element.getAttribute('contenteditable') === 'true').catch(() => false);
    if (isEditable) {
        await locator.focus();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(value);
        await locator.evaluate((element) => {
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const text = await locator.evaluate((element) => element.textContent || '');
        if (text === value) {
            return;
        }
    }

    try {
        await locator.fill(value, { timeout: 5000 });
        const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
        if (tagName === 'textarea' || tagName === 'input') {
            if (await locator.inputValue({ timeout: 1000 }) === value) {
                return;
            }
        }
        if (!isEditable && tagName !== 'textarea' && tagName !== 'input') {
            return;
        }
    } catch (_e) {
        // Fall back to keyboard input for inputs that reject Playwright fill.
    }

    await locator.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(value);
}

function createUniqueFilePath(fs, directory, fileName) {
    const parsedName = path.parse(fileName);
    let candidate = path.join(directory, fileName);
    let index = 1;

    while (fs.existsSync(candidate)) {
        candidate = path.join(directory, `${parsedName.name}_${index}${parsedName.ext}`);
        index += 1;
    }

    return candidate;
}

function buildDateMp3FileName() {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    return `${yyyy}${mm}${dd}.mp3`;
}

async function hasVisibleSunoBlockingOverlay(page) {
    const overlays = page.locator('[data-open][aria-hidden="true"][role="presentation"]');
    const count = await overlays.count();
    for (let i = 0; i < count; i++) {
        if (await overlays.nth(i).isVisible().catch(() => false)) {
            return true;
        }
    }
    return false;
}

async function waitForSunoBlockingOverlayToClose(page, timeout = 3000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!(await hasVisibleSunoBlockingOverlay(page))) {
            return true;
        }
        await page.waitForTimeout(100);
    }
    return !(await hasVisibleSunoBlockingOverlay(page));
}

async function dismissSunoBlockingDialog(page) {
    if (!(await hasVisibleSunoBlockingOverlay(page))) {
        return;
    }

    const dialogs = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible');
    const closeControls = dialogs.locator([
        'button[aria-label="Close" i]',
        'button[aria-label="Dismiss" i]',
        'button[aria-label="Cancel" i]',
        'button[aria-label="닫기" i]',
        'button[aria-label="취소" i]',
        'button:has-text("Close")',
        'button:has-text("Dismiss")',
        'button:has-text("Cancel")',
        'button:has-text("닫기")',
        'button:has-text("취소")'
    ].join(', '));

    const count = await closeControls.count();
    for (let i = 0; i < count; i++) {
        const control = closeControls.nth(i);
        if (!(await control.isVisible().catch(() => false))) continue;
        await control.click({ timeout: 3000 }).catch(() => {});
        if (await waitForSunoBlockingOverlayToClose(page)) {
            return;
        }
    }

    await page.keyboard.press('Escape');
    if (await waitForSunoBlockingOverlayToClose(page)) {
        return;
    }

    throw new Error('Suno 안내 창이 생성 버튼을 가리고 있습니다. 열린 Suno 창에서 안내 내용을 확인하고 닫은 뒤 다시 시도해 주세요.');
}

async function clickSunoCreateButton(page) {
    const selectors = [
        'button[aria-label="Create song"]',
        'button[aria-label*="Create song" i]',
        'button:has-text("Create")',
        'button:has-text("Generate")',
        'button:has-text("생성")',
        'button[aria-label*="Create" i]',
        'button[aria-label*="Generate" i]',
        'button[aria-label*="생성" i]'
    ];

    let createButton = null;
    for (const selector of selectors) {
        try {
            createButton = await firstVisible(page, page.locator(selector), 1500);
            break;
        } catch (_error) {
            // Try the next selector in priority order.
        }
    }
    if (!createButton) {
        throw new Error('Suno Create button was not found.');
    }

    await createButton.waitFor({ state: 'visible', timeout: 10000 });
    const buttonHandle = await createButton.elementHandle();
    await page.waitForFunction((element) => {
        return !element.disabled && element.getAttribute('aria-disabled') !== 'true';
    }, buttonHandle, { timeout: 10000 });
    await dismissSunoBlockingDialog(page);
    await createButton.click({ timeout: 10000 });
}

async function getSunoTrackIdentity(menuButton) {
    return menuButton.evaluate((button) => {
        let container = button.parentElement;
        while (container && container !== document.body) {
            const links = Array.from(container.querySelectorAll('a[href]'));
            for (const link of links) {
                const href = link.href || link.getAttribute('href') || '';
                const match = href.match(/\/(?:song|clip)\/([^/?#]+)/i);
                if (match) {
                    return {
                        id: match[1],
                        href,
                        title: (link.textContent || '').trim().replace(/\s+/g, ' ')
                    };
                }
            }
            container = container.parentElement;
        }
        return null;
    });
}

async function snapshotSunoTrackIds(page) {
    const ids = new Set();
    const menuButtons = page.locator('button[aria-label="More options"]');
    const count = await menuButtons.count();
    for (let i = 0; i < count; i++) {
        const identity = await getSunoTrackIdentity(menuButtons.nth(i)).catch(() => null);
        if (identity?.id) ids.add(identity.id);
    }
    return ids;
}

async function findNewSunoTrack(page, existingTrackIds) {
    const menuButtons = page.locator('button[aria-label="More options"]');
    const count = await menuButtons.count();
    for (let i = 0; i < count; i++) {
        const menuButton = menuButtons.nth(i);
        if (!(await menuButton.isVisible().catch(() => false))) continue;
        const identity = await getSunoTrackIdentity(menuButton).catch(() => null);
        if (identity?.id && !existingTrackIds.has(identity.id)) {
            return { ...identity, menuButton };
        }
    }
    return null;
}

async function sunoMp3DownloadButton(page) {
    // The current UI selects a format in a dialog before starting the download.
    // Scope to the visible dialog so hidden cookie/previous dialogs cannot match.
    const dialog = page.locator('[role="dialog"]:visible').filter({
        has: page.getByRole('button', { name: 'MP3', exact: true })
    }).first();
    if (await dialog.isVisible()) {
        // These are multi-select toggles; clicking an already selected MP3
        // clears it. Other selected formats would produce a ZIP instead.
        for (const format of ['M4A', 'MP3', 'WAV', 'MP4 video asset']) {
            const option = dialog.getByRole('button', { name: format, exact: true });
            if (!await option.isVisible()) continue;
            const selected = await option.evaluate(element =>
                element.getAttribute('aria-pressed') === 'true'
                || element.getAttribute('aria-checked') === 'true'
                || element.classList.contains('bg-foreground-primary'));
            if (selected !== (format === 'MP3')) await option.click();
        }
        return dialog.getByRole('button', { name: /^(Unlock & Download|Download)$/ });
    }
    return page.locator('button[aria-label="MP3 Audio"], button:has-text("MP3 Audio"), [role="menuitem"]:has-text("MP3 Audio")').first();
}

async function downloadSunoMp3(page, button, timeout = 120000) {
    // Unlock can either download immediately or reveal a separate Download action.
    // Keep the listener active across both steps, and never repeat the unlock.
    let download;
    const onDownload = value => { download = value; };
    page.on('download', onDownload);
    const deadline = Date.now() + timeout;
    try {
        const unlocking = (await button.innerText()).trim() === 'Unlock & Download';
        await button.click({ timeout: Math.max(1, deadline - Date.now()) });
        let confirmed = !unlocking;
        while (Date.now() < deadline) {
            if (download) return download;
            if (!confirmed) {
                const next = await sunoMp3DownloadButton(page);
                if (await next.isVisible() && await next.isEnabled()
                    && (await next.innerText()).trim() === 'Download') {
                    if (download) return download;
                    confirmed = true;
                    await next.click({ timeout: Math.max(1, deadline - Date.now()) });
                }
            }
            await page.waitForTimeout(250);
        }
        throw new Error('Suno MP3 download timed out after unlock/download action');
    } finally {
        page.off('download', onDownload);
    }
}

function registerSunoIpc({ ipcMain, app, isDev }) {
    ipcMain.handle('generate-suno-song', async (event, payload) => {
        const fs = require('fs');
        const { chromium } = require('playwright-extra');
        const stealth = require('puppeteer-extra-plugin-stealth')();
        chromium.use(stealth);
        const articleData = assertArticleData(payload?.articleData || payload);
        const stylePrompt = payload?.articleData
            ? assertText(payload.stylePrompt, 'Suno style prompt', 1000)
            : '아주 빠른 한국의 랩';
        
        const userDataDir = path.join(app.getPath('userData'), 'suno-playwright-session');
        const sunoDir = getOutputDir(app, isDev, 'suno');
            
        // Ensure the directory exists    
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        if (!fs.existsSync(sunoDir)) {
            fs.mkdirSync(sunoDir, { recursive: true });
        }
        
        try {    
            // 이미 브라우저가 열려 있는지 확인 및 재사용    
            if (sunoBrowserContext) {    
                try {    
                    const pages = sunoBrowserContext.pages();    
                    if (pages.length > 0) {    
                        const page = pages[0];    
                        await page.bringToFront();    
                        console.log('Reusing existing Suno browser context');    
                    } else {    
                        sunoBrowserContext = null;    
                    }    
                } catch (_e) {
                    sunoBrowserContext = null;
                }
            }    
        
            if (!sunoBrowserContext) {    
                // Remove SingletonLock if it exists (prevents "Target page, context or browser has been closed" error)    
                const lockFile = path.join(userDataDir, 'SingletonLock');    
                if (fs.existsSync(lockFile)) {    
                    try {    
                        fs.unlinkSync(lockFile);    
                        console.log('Removed Suno browser lock file');    
                    } catch (e) {    
                        console.warn('Could not remove lock file:', e.message);    
                    }    
                }    
        
                event.sender.send('suno-status', '브라우저를 엽니다... (필요시 로그인해주세요)');    
                    
                // Launch persistent context to keep the session alive across runs    
                sunoBrowserContext = await chromium.launchPersistentContext(userDataDir, {
                    headless: false,
                    acceptDownloads: true,
                    downloadsPath: sunoDir,
                    viewport: { width: 1280, height: 800 }
                });
            }    
        
            const context = sunoBrowserContext;    
            const page = context.pages()[0] || await context.newPage();    
        
                
            event.sender.send('suno-status', 'Suno AI Create 화면으로 이동합니다... 로그인 화면이 보이면 로그인해주세요.');    
            await page.goto('https://suno.com/create');    
            await waitForSunoLogin(page, event);
            await closeSunoCookieBanner(page);
            await page.waitForTimeout(1000);
        
            event.sender.send('suno-status', '로그인 확인 완료! Create 화면을 준비합니다.');    
        
            event.sender.send('suno-status', 'Custom/Advanced 모드를 활성화합니다.');    
                
            // Activate Advanced Mode (formerly Custom Mode)    
            // User said: "Custom Mode" (직접 가사 입력 모드) 활성화    
            await ensureSunoAdvancedMode(page, event);
            await ensureSunoWriteLyricsMode(page, event);
        
            event.sender.send('suno-status', '가사와 스타일, 제목을 입력합니다...');    
                
            // 0. Close Cookie Banner if exists    
            await closeSunoCookieBanner(page);
        
            // 1. Fill Lyrics (summary) - Use insertText to preserve newlines perfectly    
            const summaryText = articleData.summary || '';
            const lyricsInput = await firstVisible(page, sunoLyricsInputs(page));
            await replaceInputText(page, lyricsInput, summaryText);
    
            // 2. Fill Style
            const styleInput = await firstVisible(page, sunoStyleInputs(page));
            await replaceInputText(page, styleInput, stylePrompt);
    
            /*
            const lyricsInput = await firstVisible(page, page.locator('[data-testid*="lyrics-wrapper" i] textarea, [data-testid="lyrics-input-textarea"], textarea[placeholder*="lyrics" i], textarea[placeholder*="가사" i]'));
            await lyricsInput.scrollIntoViewIfNeeded();
            await lyricsInput.focus();
            await page.keyboard.insertText(summaryText);
            
            // 2. Fill Style
            const styleInput = await firstVisible(page, page.locator('[data-testid*="styles-wrapper" i] textarea, [data-testid="tag-input-textarea"], [placeholder="Style of Music" i], [placeholder="음악 스타일" i], textarea[placeholder*="인트로" i], textarea[aria-label*="Style" i], textarea[aria-label*="스타일" i]'));
            await styleInput.scrollIntoViewIfNeeded();
            await styleInput.fill('아주 빠른 한국의 랩');
    
            */
            // 3. Fill Title
            const titleInputs = sunoTitleInputs(page);
            if (articleData.title && await titleInputs.count() > 0) {
                try {
                    const titleInput = await firstVisible(page, titleInputs, 5000);
                    await titleInput.scrollIntoViewIfNeeded();
                    await titleInput.fill(articleData.title);
                } catch (err) {
                    console.log('Title fill error, skipping...', err.message);
                }
            }    
        
            event.sender.send('suno-status', '노래 생성을 시작합니다! (약 2분 소요)');

            // Capture the current cards before generation. The first card in the
            // list is not necessarily the result of this request.
            const existingTrackIds = await snapshotSunoTrackIds(page);
                
            // Click Create button    
            await clickSunoCreateButton(page);
        
            // Wait for generation and download    
            // We look for the newly created track. Usually it's at the top of the list.    
            event.sender.send('suno-status', '곡 생성 완료 대기 중... (취소하지 마세요)');    
        
            // Wait for the track to be ready (loader disappears or play button appears)    
            // This is a bit tricky, so we'll wait for a reasonable amount of time or look for the first menu button    
            await page.waitForTimeout(60000); // Wait at least 1 minute for generation to start showing progress    
                
            // Loop to find and click download when ready
            const startTime = Date.now();
            const timeout = 300000; // 5 minutes max
            let downloadWasTriggered = false;
        
            while (Date.now() - startTime < timeout) {    
                try {    
                    // Select only a card that appeared after this request.
                    const newTrack = await findNewSunoTrack(page, existingTrackIds);
                    const menuButton = newTrack?.menuButton;
                        
                    if (menuButton && await menuButton.isVisible()) {
                        event.sender.send('suno-status', `새 곡 확인: ${newTrack.title || newTrack.id}`);
                        await menuButton.click({ force: true });    
                        await page.waitForTimeout(1000);    
                            
                        // Click Download in the menu    
                        const downloadMenu = page.locator('button:has-text("Download"), [role="menuitem"]:has-text("Download")').first();    
                        if (await downloadMenu.isVisible()) {    
                            await downloadMenu.click();    
                            await page.waitForTimeout(1500); // 서브 메뉴가 나타날 시간을 충분히 부여    
                                
                            // Click MP3 Audio    
                            const audioButton = await sunoMp3DownloadButton(page);
                            if (await audioButton.isVisible()) {    
        
                                event.sender.send('suno-status', 'MP3 다운로드를 시작합니다...');
                                
                                // Setup download listener before clicking so the event cannot be missed.
                                downloadWasTriggered = true;
                                const download = await downloadSunoMp3(page, audioButton);
                                const failure = await download.failure();
                                if (failure) {
                                    throw new Error(`Suno download failed: ${failure}`);
                                }
                                
                                // Save to the managed Suno output directory.
                                const fileName = buildDateMp3FileName();
                                const filePath = createUniqueFilePath(fs, sunoDir, fileName);
                                await download.saveAs(filePath);
                                event.sender.send('suno-status', `다운로드 완료: ${filePath}`);
                                return {
                                    success: true,
                                    message: 'Suno AI 곡 생성 및 MP3 다운로드가 완료되었습니다.',
                                    outputPath: filePath
                                };
                            }    
                        }    
                        // If download button not found yet, close menu and retry    
                        await page.keyboard.press('Escape');    
                    }    
                } catch (err) {
                    console.log('Polling Suno download...', err.message);
                    if (downloadWasTriggered) {
                        return {
                            success: false,
                            error: 'MP3 다운로드 클릭은 완료되었지만 앱이 완료 이벤트를 확인하지 못했습니다. 중복 다운로드를 막기 위해 재시도하지 않습니다. 브라우저 다운로드 목록을 확인해 주세요.'
                        };
                    }
                }
                await page.waitForTimeout(10000); // Poll every 10 seconds    
                event.sender.send('suno-status', `곡 생성 확인 중... (${Math.floor((Date.now() - startTime)/1000)}초 경과)`);    
            }    
        
            return { success: false, error: '곡 생성 대기 시간이 초과되었거나 다운로드 버튼을 찾을 수 없습니다. 브라우저에서 직접 확인해주세요.' };
        } catch (error) {
            console.error('Error generating Suno song:', error);
            return { success: false, error: getErrorMessage(error) };
        }
    });
}

module.exports = {
    registerSunoIpc,
    __test: {
        firstVisible,
        hasVisible,
        sunoLyricsInputs,
        sunoWriteLyricsControls,
        sunoStyleInputs,
        sunoTitleInputs,
        ensureSunoAdvancedMode,
        ensureSunoWriteLyricsMode,
        replaceInputText,
        dismissSunoBlockingDialog,
        clickSunoCreateButton,
        snapshotSunoTrackIds,
        findNewSunoTrack,
        sunoMp3DownloadButton,
        downloadSunoMp3
    }
};
