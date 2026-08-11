function normalizeReferenceLyrics(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
}

const SRT_BLOCK_HEADER_PATTERN = /^[ \t]*(\d+)[ \t]*\n[ \t]*(\d{2}:\d{2}:\d{2}[,.]\d{3})[ \t]*-->[ \t]*(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*(?:\n|$)/gm;

function normalizeSrtTimestamp(value) {
    return String(value || '').replace('.', ',');
}

function parseStructuredSrt(content, options = {}) {
    const normalized = String(content || '')
        .replace(/\r\n/g, '\n')
        .trim();
    const headers = Array.from(normalized.matchAll(SRT_BLOCK_HEADER_PATTERN));

    if (headers.length === 0 || normalized.slice(0, headers[0].index).trim()) {
        throw new Error('AI 자막 보정 결과가 올바른 SRT 블록 형식이 아닙니다.');
    }

    return headers.map((header, index) => {
        const textStart = header.index + header[0].length;
        const textEnd = index + 1 < headers.length ? headers[index + 1].index : normalized.length;
        const text = normalized.slice(textStart, textEnd)
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');
        const start = normalizeSrtTimestamp(header[2]);
        const end = normalizeSrtTimestamp(header[3]);

        if (!text && !options.allowEmptyText) {
            throw new Error('AI 자막 보정 결과가 올바른 SRT 블록 형식이 아닙니다.');
        }

        return {
            number: header[1],
            timing: `${start} --> ${end}`,
            start,
            end,
            text
        };
    });
}

function mergeRefinedSrtChunk(originalChunk, refinedChunk) {
    const originalBlocks = parseStructuredSrt(originalChunk);
    const refinedBlocks = parseStructuredSrt(refinedChunk, { allowEmptyText: true });

    if (refinedBlocks.length !== originalBlocks.length) {
        throw new Error(`AI 자막 보정 결과의 블록 수가 원본과 다릅니다. (${refinedBlocks.length}/${originalBlocks.length})`);
    }

    return originalBlocks.map((original, index) => {
        const refined = refinedBlocks[index];
        if (refined.number !== original.number || refined.start !== original.start || refined.end !== original.end) {
            throw new Error(`AI 자막 보정 결과가 ${original.number}번 자막의 번호 또는 타임코드를 변경했습니다.`);
        }

        let refinedText = refined.text;
        if (!refinedText) {
            if (!isVocalFillerOnly(original.text)) {
                throw new Error(`AI 자막 보정 결과가 ${original.number}번 자막의 일반 가사를 비웠습니다.`);
            }
            refinedText = original.text;
        }

        return [original.number, original.timing, refinedText].join('\n');
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

function isVocalFillerOnly(text) {
    const tokens = String(text || '')
        .normalize('NFKC')
        .toLocaleLowerCase('ko-KR')
        .split(/[^\p{L}\p{N}]+/gu)
        .filter(Boolean);

    return tokens.length > 0 && tokens.every((token) => VOCAL_FILLER_TOKENS.has(token));
}

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
