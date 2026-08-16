/**
 * The languages a question can be asked in.
 *
 * Three different pieces of the stack need to be told, and each wants the code
 * in a different shape: the browser's recogniser takes a BCP-47 tag, Whisper
 * takes ISO-639-1 on the server, and speech synthesis picks its voice by
 * matching the tag's prefix. They are kept together here so adding a language
 * is one entry rather than three.
 *
 * "Detect" exists because Whisper can identify the language itself. The
 * browser's recogniser cannot, so it falls back to whatever the browser is
 * set to — which is the best guess available and usually right.
 */
export const LANGUAGES = [
    { code: 'auto', label: 'Detect', bcp47: '' },
    { code: 'en', label: 'English', bcp47: 'en-US' },
    { code: 'es', label: 'Español', bcp47: 'es-ES' },
    { code: 'fr', label: 'Français', bcp47: 'fr-FR' },
    { code: 'de', label: 'Deutsch', bcp47: 'de-DE' },
    { code: 'pt', label: 'Português', bcp47: 'pt-BR' },
    { code: 'it', label: 'Italiano', bcp47: 'it-IT' },
    { code: 'hi', label: 'हिन्दी', bcp47: 'hi-IN' },
    { code: 'ar', label: 'العربية', bcp47: 'ar-SA' },
    { code: 'ru', label: 'Русский', bcp47: 'ru-RU' },
    { code: 'zh', label: '中文', bcp47: 'zh-CN' },
    { code: 'ja', label: '日本語', bcp47: 'ja-JP' },
];

export const DEFAULT_LANGUAGE = 'en';

const byCode = new Map(LANGUAGES.map((entry) => [entry.code, entry]));

export const isSupportedLanguage = (code) => byCode.has(code);

/**
 * The BCP-47 tag for the browser's recogniser and synthesiser.
 *
 * `browserDefault` is passed in rather than read here so this stays testable
 * off a browser; callers hand it navigator.language.
 */
export function bcp47For(code, browserDefault = 'en-US') {
    const entry = byCode.get(code);
    if (!entry || !entry.bcp47) return browserDefault || 'en-US';
    return entry.bcp47;
}

/** The prefix a speech-synthesis voice's `lang` has to match. */
export function voicePrefixFor(code, browserDefault = 'en-US') {
    return bcp47For(code, browserDefault).slice(0, 2).toLowerCase();
}
