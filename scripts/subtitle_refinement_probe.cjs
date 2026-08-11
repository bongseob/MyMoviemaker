const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSubtitleIpc } = require('../electron/services/subtitle-refiner.cjs');
const {
    normalizeReferenceLyrics,
    mergeRefinedSrtChunk,
    assertRefinedLyricsMatchReference
} = require('../electron/services/subtitle-refinement.cjs');
const { normalizeSrtSegments } = require('../electron/services/subtitle-utils.cjs');

function testReferenceLyricsRemoveBlankLines() {
    const input = '첫 번째 가사\n\n   \n두 번째 가사\r\n\r\n세 번째 가사';

    assert.strictEqual(
        normalizeReferenceLyrics(input),
        '첫 번째 가사\n두 번째 가사\n세 번째 가사'
    );
}

function testRefinementKeepsOriginalSrtStructure() {
    const original = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '잘못 인식된 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '두 번재 가사'
    ].join('\n');
    const refined = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '정확하게 교정된 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '두 번째 가사'
    ].join('\n');

    assert.strictEqual(mergeRefinedSrtChunk(original, refined), refined);
}

function testRefinementRejectsChangedStructure() {
    const original = '1\n00:00:00,000 --> 00:00:03,000\n원본 가사';

    assert.throws(
        () => mergeRefinedSrtChunk(original, '1\n00:00:01,000 --> 00:00:03,000\n교정 가사'),
        /번호 또는 타임코드를 변경했습니다/
    );
    assert.throws(
        () => mergeRefinedSrtChunk(`${original}\n\n2\n00:00:03,000 --> 00:00:06,000\n다음 가사`, original),
        /블록 수가 원본과 다릅니다/
    );
}

function testRefinementAcceptsSafeSrtFormattingVariants() {
    const original = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '부정확한 첫 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '부정확한 둘째 가사'
    ].join('\n');
    const refinedWithoutBlankSeparator = [
        '1',
        '00:00:00.000  -->  00:00:03.000',
        '정확한 첫 가사',
        '2',
        '00:00:03.000 --> 00:00:06.000',
        '정확한 둘째 가사'
    ].join('\n');
    const expected = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '정확한 첫 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '정확한 둘째 가사'
    ].join('\n');

    assert.strictEqual(mergeRefinedSrtChunk(original, refinedWithoutBlankSeparator), expected);
}

function testSrtLyricsSurviveInternalBlankLines() {
    const input = [
        '1',
        '00:00:00,000 --> 00:00:05,000',
        '첫 번째 가사',
        '',
        '두 번째 가사',
        '',
        '2',
        '00:00:05,000 --> 00:00:10,000',
        '세 번째 가사'
    ].join('\n');
    const output = normalizeSrtSegments(input, { maxBlockChars: 100, maxSegmentSeconds: 20 });

    assert.match(output, /첫 번째 가사 두 번째 가사/);
    assert.match(output, /세 번째 가사/);
}

function testLongSrtBlockKeepsContinuousAllocatedTime() {
    const input = [
        '1',
        '00:00:00,000 --> 00:00:12,000',
        '이것은 하나의 자막 블록이 지나치게 길게 생성되었을 때 여러 구간으로 나누고 전체 시간을 글자 길이에 따라 적절히 배분하는지 확인하기 위한 테스트 문장입니다'
    ].join('\n');
    const output = normalizeSrtSegments(input);
    const timings = Array.from(output.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g));

    assert.ok(timings.length > 1 && timings.length <= 5);
    assert.strictEqual(timings[0][1], '00:00:00,000');
    assert.strictEqual(timings[timings.length - 1][2], '00:00:12,000');
    for (let index = 1; index < timings.length; index += 1) {
        assert.strictEqual(timings[index - 1][2], timings[index][1]);
    }
}

function testRefinedLyricsMustMatchReference() {
    const reference = '첫 번째 가사\n\n두 번째 가사';
    const matchingSrt = '1\n00:00:00,000 --> 00:00:03,000\n첫 번째 가사,\n\n2\n00:00:03,000 --> 00:00:06,000\n두 번째 가사.';
    const unrelatedSrt = '1\n00:00:00,000 --> 00:00:03,000\n전혀 다른 내용';

    assert.doesNotThrow(() => assertRefinedLyricsMatchReference(reference, matchingSrt));
    assert.throws(
        () => assertRefinedLyricsMatchReference(reference, unrelatedSrt),
        /보정된 자막 내용이 원문 가사와 일치하지 않습니다/
    );
}

function testRefinedLyricsIgnoreStandaloneVocalFillers() {
    const reference = '오늘 다시 시작해\n우리 함께 노래해';
    const refinedSrt = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        'Yeah, 오늘 다시 시작해, oh',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '우리 함께 노래해, 워어'
    ].join('\n');

    assert.doesNotThrow(() => assertRefinedLyricsMatchReference(reference, refinedSrt));
    assert.throws(
        () => assertRefinedLyricsMatchReference('오늘 다시 시작해', '1\n00:00:00,000 --> 00:00:03,000\n늘 다시 시작해'),
        /보정된 자막 내용이 원문 가사와 일치하지 않습니다/
    );
    assert.doesNotThrow(
        () => assertRefinedLyricsMatchReference('아 오늘 다시 시작해', '1\n00:00:00,000 --> 00:00:03,000\n아 오늘 다시 시작해')
    );
    assert.throws(
        () => assertRefinedLyricsMatchReference('아 오늘 다시 시작해', '1\n00:00:00,000 --> 00:00:03,000\n오늘 다시 시작해'),
        /보정된 자막 내용이 원문 가사와 일치하지 않습니다/
    );
}

async function testSubtitleIpcGenerationAndRefinementPaths() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mymoviemaker-subtitle-'));
    const mp3Path = path.join(tempRoot, 'sample.mp3');
    const srtPath = path.join(tempRoot, 'sample.srt');
    const invalidSrtPath = path.join(tempRoot, 'invalid.srt');
    const handlers = {};
    const event = { sender: { send() {} } };
    const previousApiKey = process.env.OPENAI_API_KEY;
    let refinementPrompt = '';
    let completionContent;

    const generatedSrt = [
        '1',
        '00:00:00,000 --> 00:00:04,000',
        '첫 번째 가사',
        '',
        '두 번째 가사'
    ].join('\n');
    const sourceSrt = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '부정확한 첫 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '부정확한 둘째 가사'
    ].join('\n');
    const refinedSrt = [
        '1',
        '00:00:00,000 --> 00:00:03,000',
        '정확한 첫 가사',
        '',
        '2',
        '00:00:03,000 --> 00:00:06,000',
        '정확한 둘째 가사'
    ].join('\n');
    completionContent = refinedSrt;

    class FakeOpenAI {
        constructor() {
            this.audio = { transcriptions: { create: async () => generatedSrt } };
            this.chat = {
                completions: {
                    create: async ({ messages }) => {
                        refinementPrompt = messages[0].content;
                        return { choices: [{ message: { content: completionContent } }] };
                    }
                }
            };
        }
    }

    try {
        process.env.OPENAI_API_KEY = 'test-key';
        fs.writeFileSync(mp3Path, 'fake audio');
        fs.writeFileSync(srtPath, sourceSrt, 'utf8');
        fs.writeFileSync(invalidSrtPath, sourceSrt, 'utf8');
        registerSubtitleIpc({
            ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
            app: { getAppPath: () => tempRoot },
            isDev: true,
            OpenAIClient: FakeOpenAI
        });

        const generated = await handlers['generate-srt-from-suno'](event, { mp3Path });
        assert.strictEqual(generated.success, true);
        assert.match(generated.data.content, /첫 번째 가사 두 번째 가사/);

        const refined = await handlers['refine-subtitles'](event, {
            srtPath,
            summaryText: '정확한 첫 가사\n\n   \n정확한 둘째 가사'
        });
        assert.strictEqual(refined.success, true);
        assert.strictEqual(refined.data.content, refinedSrt);
        assert.match(refinementPrompt, /정확한 첫 가사\n정확한 둘째 가사/);

        completionContent = [
            '1',
            '00:00:00,000 --> 00:00:03,000',
            '전혀 다른 첫 내용',
            '',
            '2',
            '00:00:03,000 --> 00:00:06,000',
            '전혀 다른 둘째 내용'
        ].join('\n');
        const originalConsoleError = console.error;
        console.error = () => {};
        let rejected;
        try {
            rejected = await handlers['refine-subtitles'](event, {
                srtPath: invalidSrtPath,
                summaryText: '정확한 첫 가사\n정확한 둘째 가사'
            });
        } finally {
            console.error = originalConsoleError;
        }
        assert.strictEqual(rejected.success, false);
        assert.match(rejected.error, /보정된 자막 내용이 원문 가사와 일치하지 않습니다/);
        assert.strictEqual(fs.existsSync(path.join(tempRoot, 'invalid_refined.srt')), false);
    } finally {
        if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousApiKey;
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

(async () => {
    testReferenceLyricsRemoveBlankLines();
    testRefinementKeepsOriginalSrtStructure();
    testRefinementRejectsChangedStructure();
    testRefinementAcceptsSafeSrtFormattingVariants();
    testSrtLyricsSurviveInternalBlankLines();
    testLongSrtBlockKeepsContinuousAllocatedTime();
    testRefinedLyricsMustMatchReference();
    testRefinedLyricsIgnoreStandaloneVocalFillers();
    await testSubtitleIpcGenerationAndRefinementPaths();
    console.log('Subtitle refinement probe passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
