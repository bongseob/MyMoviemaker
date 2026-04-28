const path = require('path');
const fs = require('fs');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv']);
const SRT_EXTENSIONS = new Set(['.srt']);

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value;
}

function normalizeLocalPath(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} is required.`);
    }

    return decodeURIComponent(value.trim().replace('file://', '').replace(/^\/([a-zA-Z]:)/, '$1'));
}

function assertExistingFile(value, label, allowedExtensions) {
    const filePath = normalizeLocalPath(value, label);
    const ext = path.extname(filePath).toLowerCase();

    if (allowedExtensions && !allowedExtensions.has(ext)) {
        throw new Error(`${label} must be one of: ${Array.from(allowedExtensions).join(', ')}`);
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`${label} was not found: ${filePath}`);
    }

    return filePath;
}

function assertText(value, label, maxLength = 20000) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} is required.`);
    }

    if (value.length > maxLength) {
        throw new Error(`${label} is too long. Maximum length is ${maxLength} characters.`);
    }

    return value.trim();
}

function optionalText(value, label, maxLength = 20000) {
    if (value == null) return '';
    if (typeof value !== 'string') {
        throw new Error(`${label} must be text.`);
    }

    if (value.length > maxLength) {
        throw new Error(`${label} is too long. Maximum length is ${maxLength} characters.`);
    }

    return value;
}

function assertArticleData(articleData) {
    const data = assertPlainObject(articleData, 'Article data');
    return {
        title: assertText(data.title, 'Article title', 200),
        subtopics: Array.isArray(data.subtopics) ? data.subtopics.map((item) => assertText(item, 'Subtopic', 200)) : [],
        summary: assertText(data.summary, 'Article summary', 5000),
        hashtags: Array.isArray(data.hashtags) ? data.hashtags.map((item) => assertText(item, 'Hashtag', 80)) : [],
        content: assertText(data.content, 'Article content', 50000)
    };
}

function validateExportPayload(data) {
    const payload = assertPlainObject(data, 'Export payload');
    const slides = Array.isArray(payload.slides) ? payload.slides : [];

    if (slides.length === 0) {
        throw new Error('At least one image is required.');
    }

    return {
        slides: slides.map((slide, index) => {
            const item = assertPlainObject(slide, `Slide ${index + 1}`);
            const cleanPath = assertExistingFile(item.path, `Slide ${index + 1}`, IMAGE_EXTENSIONS);
            const duration = Number(item.duration);

            return {
                ...item,
                path: cleanPath,
                duration: Number.isFinite(duration) && duration > 0 ? duration : 5
            };
        }),
        audioPath: payload.audioPath ? assertExistingFile(payload.audioPath, 'Audio file', AUDIO_EXTENSIONS) : null,
        outputPath: normalizeLocalPath(payload.outputPath, 'Output path'),
        aspectRatio: payload.aspectRatio === '16:9' ? '16:9' : '9:16',
        titleText: optionalText(payload.titleText, 'Title text', 500),
        titlePosition: ['top', 'center', 'bottom'].includes(payload.titlePosition) ? payload.titlePosition : 'bottom',
        targetDuration: Math.min(Math.max(Number(payload.targetDuration) || 15, 1), 3600),
        imageDuration: Math.min(Math.max(Number(payload.imageDuration) || 5, 0.1), 3600),
        subtitlePath: payload.subtitlePath ? assertExistingFile(payload.subtitlePath, 'Subtitle file', SRT_EXTENSIONS) : null,
        subtitleTextContent: optionalText(payload.subtitleTextContent, 'Subtitle text', 50000)
    };
}

module.exports = {
    AUDIO_EXTENSIONS,
    SRT_EXTENSIONS,
    VIDEO_EXTENSIONS,
    assertArticleData,
    assertExistingFile,
    assertPlainObject,
    assertText,
    optionalText,
    validateExportPayload
};
