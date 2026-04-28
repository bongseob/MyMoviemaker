const path = require('path');
const { getErrorMessage } = require('../lib/errors.cjs');
const { getOutputDir } = require('../lib/paths.cjs');
const { assertArticleData } = require('../lib/validation.cjs');

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
    return page.locator('[data-testid*="lyrics-wrapper" i] textarea, [data-testid="lyrics-input-textarea"], textarea[placeholder*="lyrics" i], textarea[placeholder*="가사" i]');
}

function sunoStyleInputs(page) {
    return page.locator('[data-testid*="styles-wrapper" i] textarea, [data-testid="tag-input-textarea"], [placeholder="Style of Music" i], [placeholder="음악 스타일" i], textarea[placeholder*="인트로" i], textarea[aria-label*="Style" i], textarea[aria-label*="스타일" i]');
}

async function clickVisibleTextControl(page, pattern) {
    const clicked = await page.evaluate((source) => {
        const regex = new RegExp(source, 'i');
        const selectors = [
            'button',
            '[role="button"]',
            '[role="tab"]',
            '[role="switch"]',
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

async function ensureSunoAdvancedMode(page, event) {
    const lyricsInputs = sunoLyricsInputs(page);
    const styleInputs = sunoStyleInputs(page);

    if (await hasVisible(page, lyricsInputs, 2000) && await hasVisible(page, styleInputs, 2000)) {
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

            if (await hasVisible(page, lyricsInputs, 2500) && await hasVisible(page, styleInputs, 2500)) {
                return;
            }
        } catch (e) {
            console.log('Advanced mode control click failed:', e.message);
        }
    }

    const clickedByText = await clickVisibleTextControl(page, /advanced|custom|고급|커스텀|맞춤/);
    if (clickedByText) {
        await page.waitForTimeout(1500);
        if (await hasVisible(page, lyricsInputs, 3000) && await hasVisible(page, styleInputs, 3000)) {
            return;
        }
    }

    event.sender.send('suno-status', 'Advanced 모드를 자동으로 찾지 못했습니다. Suno 창에서 Advanced/Custom 탭을 직접 선택해주세요.');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (await hasVisible(page, lyricsInputs, 1000) && await hasVisible(page, styleInputs, 1000)) {
            return;
        }
        await page.waitForTimeout(1000);
    }

    throw new Error('Suno Advanced/Custom mode was not enabled, so lyrics/style inputs were not found.');
}

async function replaceInputText(page, locator, value) {
    await locator.scrollIntoViewIfNeeded();
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

function registerSunoIpc({ ipcMain, app, isDev }) {
    ipcMain.handle('generate-suno-song', async (event, articleData) => {
        const fs = require('fs');
        const { chromium } = require('playwright-extra');
        const stealth = require('puppeteer-extra-plugin-stealth')();
        chromium.use(stealth);
        articleData = assertArticleData(articleData);
        
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
        
                
            await page.goto('https://suno.com/');    
                
            event.sender.send('suno-status', 'Suno AI 접속 중... 수동으로 로그인을 완료해주세요.');    
                
            // Wait until user is logged in and we can see the "Create" menu on the left    
            try {    
                await page.waitForSelector('a[href*="/create"]', { timeout: 300000 }); // 5 minutes for manual login    
            } catch (_e) {
                return { success: false, error: '시간 초과: 로그인이 완료되지 않았거나 페이지 로딩에 실패했습니다.' };
            }
        
            event.sender.send('suno-status', '로그인 확인 완료! 좌측 Create 메뉴를 선택합니다.');    
                
            // Click Create menu on the left    
            await page.click('a[href*="/create"]');    
            await page.waitForTimeout(2000);    
        
            event.sender.send('suno-status', 'Custom/Advanced 모드를 활성화합니다.');    
                
            // Activate Advanced Mode (formerly Custom Mode)    
            // User said: "Custom Mode" (직접 가사 입력 모드) 활성화    
            await ensureSunoAdvancedMode(page, event);
        
            event.sender.send('suno-status', '가사와 스타일, 제목을 입력합니다...');    
                
            // 0. Close Cookie Banner if exists    
            try {    
                const cookieBtn = page.locator('button:has-text("Accept All Cookies"), button:has-text("동의"), button#onetrust-accept-btn-handler').first();    
                if (await cookieBtn.isVisible()) {    
                    await cookieBtn.click();    
                    await page.waitForTimeout(500);    
                }    
            } catch (_e) {
                // Cookie banners vary by locale and are optional.
            }
        
            // 1. Fill Lyrics (summary) - Use insertText to preserve newlines perfectly    
            const summaryText = articleData.summary || '';
            const lyricsInput = await firstVisible(page, sunoLyricsInputs(page));
            await replaceInputText(page, lyricsInput, summaryText);
    
            // 2. Fill Style
            const styleInput = await firstVisible(page, sunoStyleInputs(page));
            await replaceInputText(page, styleInput, '아주 빠른 한국의 랩');
    
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
            const titleInputs = page.locator('[data-testid*="title-wrapper" i] input, [data-testid="title-input-textarea"], [placeholder*="title" i], [placeholder*="제목" i]');
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
                
            // Click Create button    
            await page.click('button:has-text("Create")');    
        
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
                    // Find the first track's menu button (three dots)    
                    const menuButton = page.locator("button[aria-label='More options']").first();    
                        
                    if (await menuButton.isVisible()) {    
                        await menuButton.click({ force: true });    
                        await page.waitForTimeout(1000);    
                            
                        // Click Download in the menu    
                        const downloadMenu = page.locator('button:has-text("Download"), [role="menuitem"]:has-text("Download")').first();    
                        if (await downloadMenu.isVisible()) {    
                            await downloadMenu.click();    
                            await page.waitForTimeout(1500); // 서브 메뉴가 나타날 시간을 충분히 부여    
                                
                            // Click MP3 Audio    
                            const audioButton = page.locator('button[aria-label="MP3 Audio"], button:has-text("MP3 Audio"), [role="menuitem"]:has-text("MP3 Audio")').first();    
                            if (await audioButton.isVisible()) {    
        
                                event.sender.send('suno-status', 'MP3 다운로드를 시작합니다...');
                                
                                // Setup download listener before clicking so the event cannot be missed.
                                downloadWasTriggered = true;
                                const [download] = await Promise.all([
                                    page.waitForEvent('download', { timeout: 120000 }),
                                    audioButton.click()
                                ]);
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

module.exports = { registerSunoIpc };
