function normalizeReferenceLyrics(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}

const SRT_TIMING_PATTERN = /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}(?:\s+.*)?$/;
const SRT_BLOCK_BOUNDARY = /\n{2,}(?=\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->)/;

function parseStructuredSrt(content) {
    return String(content || '')
        .replace(/\r\n/g, '\n')
        .trim()
        .split(SRT_BLOCK_BOUNDARY)
        .map((block) => {
            const lines = block.split('\n');
            const number = lines.shift()?.trim() || '';
            const timing = lines.shift()?.trim() || '';
            const text = lines.map((line) => line.trim()).filter(Boolean).join('\n');

            if (!/^\d+$/.test(number) || !SRT_TIMING_PATTERN.test(timing) || !text) {
                throw new Error('AI 자막 보정 결과가 올바른 SRT 블록 형식이 아닙니다.');
            }

            return { number, timing, text };
        });
}

function mergeRefinedSrtChunk(originalChunk, refinedChunk) {
    const originalBlocks = parseStructuredSrt(originalChunk);
    const refinedBlocks = parseStructuredSrt(refinedChunk);

    if (refinedBlocks.length !== originalBlocks.length) {
        throw new Error(`AI 자막 보정 결과의 블록 수가 원본과 다릅니다. (${refinedBlocks.length}/${originalBlocks.length})`);
    }

    return originalBlocks.map((original, index) => {
        const refined = refinedBlocks[index];
        if (refined.number !== original.number || refined.timing !== original.timing) {
            throw new Error(`AI 자막 보정 결과가 ${original.number}번 자막의 번호 또는 타임코드를 변경했습니다.`);
        }

        return [original.number, original.timing, refined.text].join('\n');
    }).join('\n\n');
}

const VOCAL_FILLER_TOKENS = new Set([
    'yeah', 'yea', 'ya', 'yo', 'hey',
    'oh', 'ooh', 'woo', 'woah', 'whoa',
    'uh', 'um', 'hmm',
    '예', '예예', '야', '요', '헤이',
    '오', '오오', '우', '워', '워어',
    '음', '어', '아'
]);

function canonicalizeLyrics(text) {
    return String(text || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ko-KR')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function lyricsMatchAllowingExtraFillers(referenceText, refinedText) {
    const reference = canonicalizeLyrics(referenceText);
    const refinedTokens = String(refinedText || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ko-KR')
        .split(/[^\p{L}\p{N}]+/gu)
        .filter(Boolean);
    let positions = new Set([0]);

    for (const token of refinedTokens) {
        const nextPositions = new Set(VOCAL_FILLER_TOKENS.has(token) ? positions : []);
        for (const position of positions) {
            if (reference.startsWith(token, position)) {
                nextPositions.add(position + token.length);
            }
        }
        positions = nextPositions;
        if (positions.size === 0) return false;
    }

    return positions.has(reference.length);
}

function assertRefinedLyricsMatchReference(referenceLyrics, refinedSrt) {
    const reference = normalizeReferenceLyrics(referenceLyrics);
    const refined = parseStructuredSrt(refinedSrt).map((block) => block.text).join('\n');

    if (!canonicalizeLyrics(reference) || !lyricsMatchAllowingExtraFillers(reference, refined)) {
        throw new Error('보정된 자막 내용이 원문 가사와 일치하지 않습니다. 잘못된 결과는 저장하지 않았습니다.');
    }
}

module.exports = {
    normalizeReferenceLyrics,
    mergeRefinedSrtChunk,
    assertRefinedLyricsMatchReference
};
