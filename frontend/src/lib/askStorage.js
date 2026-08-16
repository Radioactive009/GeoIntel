/**
 * The Ask page's thread, kept in this browser.
 *
 * A conversation held in component state is lost to a stray reload, which is
 * worse here than in most places: hands-free mode encourages long threads, and
 * every turn in one cost the site an upstream request that cannot be got back.
 *
 * Local storage rather than the server for the same reason the watchlist is
 * local — no accounts, no per-user rows, and a question someone asked is their
 * business rather than something to collect.
 */
import { storableTurns } from './ask.js';

const THREAD_KEY = 'geointel.ask.thread';
const LANGUAGE_KEY = 'geointel.ask.language';
const MODE_KEY = 'geointel.ask.mode';

export function loadThread() {
    try {
        const raw = window.localStorage.getItem(THREAD_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        // Hand-edited or half-written storage should cost the thread, not the page.
        return Array.isArray(parsed) ? storableTurns(parsed) : [];
    } catch {
        return [];
    }
}

export function saveThread(turns) {
    try {
        const keep = storableTurns(turns);
        if (keep.length) window.localStorage.setItem(THREAD_KEY, JSON.stringify(keep));
        else window.localStorage.removeItem(THREAD_KEY);
    } catch {
        /* private mode or quota — the thread simply does not outlive the tab */
    }
}

export function loadLanguage(fallback) {
    try {
        return window.localStorage.getItem(LANGUAGE_KEY) || fallback;
    } catch {
        return fallback;
    }
}

export function saveLanguage(code) {
    try {
        window.localStorage.setItem(LANGUAGE_KEY, code);
    } catch {
        /* nothing to do; the choice lasts as long as the page does */
    }
}

/** Someone studying is studying on their next visit too. */
export function loadMode() {
    try {
        return window.localStorage.getItem(MODE_KEY) === 'exam' ? 'exam' : 'default';
    } catch {
        return 'default';
    }
}

export function saveMode(mode) {
    try {
        window.localStorage.setItem(MODE_KEY, mode);
    } catch { /* the choice lasts as long as the page does */ }
}
