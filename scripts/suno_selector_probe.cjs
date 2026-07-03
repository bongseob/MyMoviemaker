const assert = require('assert');
const { chromium } = require('playwright');
const {
    __test: {
        ensureSunoAdvancedMode,
        ensureSunoWriteLyricsMode,
        sunoLyricsInputs,
        sunoStyleInputs,
        sunoTitleInputs,
        replaceInputText,
        clickSunoCreateButton
    }
} = require('../electron/services/suno.cjs');

function eventSink() {
    return {
        sender: {
            send(_channel, _message) {}
        }
    };
}

async function withPage(html, callback) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.setContent(html);
        await callback(page);
    } finally {
        await browser.close();
    }
}

async function testRenamedLyricsTab() {
    await withPage(`
        <button id="lyrics-mode" type="button">Lyrics</button>
        <section id="custom-form" hidden>
            <textarea aria-label="Lyrics" placeholder="Enter lyrics"></textarea>
            <textarea aria-label="Style of Music" placeholder="Describe a style"></textarea>
            <input aria-label="Title" placeholder="Song title" />
            <button type="button" id="create">Generate</button>
        </section>
        <script>
            document.getElementById('lyrics-mode').addEventListener('click', () => {
                document.getElementById('custom-form').hidden = false;
            });
            document.getElementById('create').addEventListener('click', () => {
                document.body.dataset.created = 'true';
            });
        </script>
    `, async (page) => {
        await ensureSunoAdvancedMode(page, eventSink(), { manualTimeoutMs: 100 });
        await ensureSunoWriteLyricsMode(page, eventSink(), { manualTimeoutMs: 100 });

        const lyricsInput = sunoLyricsInputs(page).first();
        const styleInput = sunoStyleInputs(page).first();
        const titleInput = sunoTitleInputs(page).first();

        await replaceInputText(page, lyricsInput, '테스트 가사');
        await replaceInputText(page, styleInput, '빠른 한국 랩');
        await replaceInputText(page, titleInput, '테스트 제목');
        await clickSunoCreateButton(page);

        assert.strictEqual(await lyricsInput.inputValue(), '테스트 가사');
        assert.strictEqual(await styleInput.inputValue(), '빠른 한국 랩');
        assert.strictEqual(await titleInput.inputValue(), '테스트 제목');
        assert.strictEqual(await page.locator('body').getAttribute('data-created'), 'true');
    });
}

async function testFieldsAlreadyVisibleWithoutCustomTab() {
    await withPage(`
        <textarea data-testid="lyrics-textarea" placeholder="Your lyrics"></textarea>
        <textarea data-testid="tag-input-textarea" placeholder="Style of Music"></textarea>
        <button type="button" aria-label="Create song">Create</button>
    `, async (page) => {
        await ensureSunoAdvancedMode(page, eventSink(), { manualTimeoutMs: 100 });
        await ensureSunoWriteLyricsMode(page, eventSink(), { manualTimeoutMs: 100 });
        assert.strictEqual(await sunoLyricsInputs(page).count(), 1);
        assert.strictEqual(await sunoStyleInputs(page).count(), 1);
    });
}

async function testCurrentSunoAdvancedEditorShape() {
    await withPage(`
        <button type="button" aria-label="Advanced">Advanced</button>
        <div role="textbox" contenteditable="true" aria-label="Lyrics editor" class="lyrics-editor-content"></div>
        <textarea aria-label="Cowriter prompt" placeholder=""></textarea>
        <textarea placeholder="math rock, mandarin, soft slow operatic r&b, sea shanty, love ballad"></textarea>
        <input placeholder="Song Title (Optional)" />
        <button type="button" aria-label="Create song">Create</button>
    `, async (page) => {
        await ensureSunoAdvancedMode(page, eventSink(), { manualTimeoutMs: 100 });
        await ensureSunoWriteLyricsMode(page, eventSink(), { manualTimeoutMs: 100 });

        const lyricsInput = sunoLyricsInputs(page).first();
        const styleInput = sunoStyleInputs(page).first();
        const titleInput = sunoTitleInputs(page).first();

        await replaceInputText(page, lyricsInput, '현재 구조 가사');
        await replaceInputText(page, styleInput, '아주 빠른 한국의 랩');
        await replaceInputText(page, titleInput, '현재 구조 제목');

        assert.strictEqual(await lyricsInput.textContent(), '현재 구조 가사');
        assert.strictEqual(await styleInput.inputValue(), '아주 빠른 한국의 랩');
        assert.strictEqual(await titleInput.inputValue(), '현재 구조 제목');

        const cowriterPrompt = page.locator('textarea[aria-label="Cowriter prompt"]');
        assert.strictEqual(await cowriterPrompt.inputValue(), '');
    });
}

(async () => {
    await testRenamedLyricsTab();
    await testFieldsAlreadyVisibleWithoutCustomTab();
    await testCurrentSunoAdvancedEditorShape();
    console.log('Suno selector probe passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
