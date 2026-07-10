function parseSrtTime(value) {
    const match = String(value || '').trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
    if (!match) return null;

    const [, hours, minutes, seconds, milliseconds] = match;
    return Number(hours) * 3600
        + Number(minutes) * 60
        + Number(seconds)
        + Number(milliseconds) / 1000;
}

function formatSrtTime(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const totalMilliseconds = Math.round(safeSeconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3600000);
    const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
    const wholeSeconds = Math.floor((totalMilliseconds % 60000) / 1000);
    const milliseconds = totalMilliseconds % 1000;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function visibleLength(text) {
    return String(text || '').replace(/\s+/g, '').length;
}

function splitOversizedToken(token, maxChars) {
    const parts = [];
    let current = '';

    for (const char of token) {
        if (visibleLength(current + char) > maxChars && current) {
            parts.push(current);
            current = char;
        } else {
            current += char;
        }
    }

    if (current) parts.push(current);
    return parts;
}

function tokenizeSubtitleText(text, maxBlockChars) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .flatMap((token) => visibleLength(token) > maxBlockChars
            ? splitOversizedToken(token, maxBlockChars)
            : [token]);
}

function splitTextIntoChunks(text, options = {}) {
    const maxBlockChars = options.maxBlockChars || 36;
    const minBlockChars = options.minBlockChars || 14;
    const tokens = tokenizeSubtitleText(text, maxBlockChars);
    const chunks = [];
    let current = '';

    for (const token of tokens) {
        const candidate = current ? `${current} ${token}` : token;
        const shouldBreakForLength = current && visibleLength(candidate) > maxBlockChars;
        const shouldBreakForPunctuation = current
            && visibleLength(current) >= minBlockChars
            && /[,.!?，。？！…;:、]$/.test(current);

        if (shouldBreakForLength || shouldBreakForPunctuation) {
            chunks.push(current);
            current = token;
        } else {
            current = candidate;
        }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [String(text || '').trim()].filter(Boolean);
}

function rebalanceChunkCount(chunks, maxCount) {
    if (chunks.length <= maxCount) return chunks;

    const text = chunks.join(' ');
    const tokens = tokenizeSubtitleText(text, Math.ceil(visibleLength(text) / maxCount) + 8);
    const targetChars = Math.ceil(visibleLength(text) / maxCount);
    const balanced = [];
    let current = '';

    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const candidate = current ? `${current} ${token}` : token;
        const remainingSlots = maxCount - balanced.length - 1;
        const remainingTokens = tokens.length - index - 1;

        if (current && visibleLength(candidate) > targetChars && remainingSlots > 0 && remainingTokens >= remainingSlots) {
            balanced.push(current);
            current = token;
        } else {
            current = candidate;
        }
    }

    if (current) balanced.push(current);

    while (balanced.length > maxCount) {
        const last = balanced.pop();
        balanced[balanced.length - 1] = `${balanced[balanced.length - 1]} ${last}`.trim();
    }

    return balanced;
}

function wrapChunkLines(text, options = {}) {
    const maxLineChars = options.maxLineChars || 18;
    const tokens = tokenizeSubtitleText(text, maxLineChars);
    const normalized = tokens.join(' ').trim();

    if (visibleLength(normalized) <= maxLineChars) {
        return normalized;
    }

    let best = null;

    for (let index = 1; index < tokens.length; index += 1) {
        const first = tokens.slice(0, index).join(' ');
        const second = tokens.slice(index).join(' ');
        const firstLength = visibleLength(first);
        const secondLength = visibleLength(second);
        const longest = Math.max(firstLength, secondLength);
        const balance = Math.abs(firstLength - secondLength);
        const overflow = Math.max(0, longest - maxLineChars);
        const score = overflow * 100 + balance;

        if (!best || score < best.score) {
            best = { first, second, score };
        }
    }

    if (best) {
        return `${best.first}\n${best.second}`;
    }

    const chars = Array.from(normalized);
    const midpoint = Math.ceil(chars.length / 2);
    return `${chars.slice(0, midpoint).join('')}\n${chars.slice(midpoint).join('')}`;
}

function parseSrtBlocks(content) {
    return String(content || '')
        .replace(/\r\n/g, '\n')
        .trim()
        .split(/\n\s*\n/)
        .map((block) => block.split('\n').map((line) => line.trimEnd()))
        .filter((lines) => lines.length >= 3)
        .map((lines) => {
            const timingIndex = lines.findIndex((line) => line.includes('-->'));
            if (timingIndex < 0) return null;

            const timingMatch = lines[timingIndex].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
            if (!timingMatch) return null;

            return {
                start: parseSrtTime(timingMatch[1]),
                end: parseSrtTime(timingMatch[2]),
                text: lines.slice(timingIndex + 1).join(' ').replace(/\s+/g, ' ').trim()
            };
        })
        .filter((block) => block && block.start !== null && block.end !== null && block.text);
}

function shouldSplitBlock(block, options) {
    const textLines = String(block.text || '').split('\n');
    const duration = block.end - block.start;

    return visibleLength(block.text) > options.maxBlockChars
        || duration > options.maxSegmentSeconds
        || textLines.some((line) => visibleLength(line) > options.maxLineChars);
}

function buildTimedChunks(block, options) {
    const duration = Math.max(0, block.end - block.start);
    const maxChunksByDuration = Math.max(1, Math.floor(duration / options.minSegmentSeconds));
    let chunks = splitTextIntoChunks(block.text, options);

    chunks = rebalanceChunkCount(chunks, Math.min(maxChunksByDuration, options.maxSplitsPerBlock));

    if (chunks.length <= 1) {
        return [{
            start: block.start,
            end: block.end,
            text: wrapChunkLines(block.text, options)
        }];
    }

    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, visibleLength(chunk)), 0);
    let cursor = block.start;

    return chunks.map((chunk, index) => {
        const isLast = index === chunks.length - 1;
        const weight = Math.max(1, visibleLength(chunk));
        const chunkDuration = isLast ? block.end - cursor : duration * (weight / totalWeight);
        const start = cursor;
        const end = isLast ? block.end : Math.min(block.end, cursor + chunkDuration);

        cursor = end;

        return {
            start,
            end,
            text: wrapChunkLines(chunk, options)
        };
    });
}

function normalizeSrtSegments(content, options = {}) {
    const settings = {
        maxBlockChars: options.maxBlockChars || 30,
        maxLineChars: options.maxLineChars || 18,
        minBlockChars: options.minBlockChars || 14,
        maxSegmentSeconds: options.maxSegmentSeconds || 4.8,
        minSegmentSeconds: options.minSegmentSeconds || 1.15,
        maxSplitsPerBlock: options.maxSplitsPerBlock || 5
    };

    const blocks = parseSrtBlocks(content);
    if (blocks.length === 0) return String(content || '').trim();

    const normalized = blocks.flatMap((block) => shouldSplitBlock(block, settings)
        ? buildTimedChunks(block, settings)
        : [{
            start: block.start,
            end: block.end,
            text: wrapChunkLines(block.text, settings)
        }]);

    return normalized.map((block, index) => [
        String(index + 1),
        `${formatSrtTime(block.start)} --> ${formatSrtTime(block.end)}`,
        block.text
    ].join('\n')).join('\n\n');
}

module.exports = {
    formatSrtTime,
    normalizeSrtSegments,
    parseSrtTime,
    splitTextIntoChunks,
    wrapChunkLines
};
