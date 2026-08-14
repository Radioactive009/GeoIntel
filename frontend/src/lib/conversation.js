/**
 * Knowing when a spoken conversation is over.
 *
 * In hands-free mode the microphone reopens by itself after every answer, so
 * something has to decide when to stop. Two signals end it: the reader says
 * so, or they say nothing at all.
 *
 * The bar for "they said so" is deliberately high. Ending a conversation
 * someone wanted to continue is far more annoying than one extra silent
 * reopen — they have to reach for the button again, which is the exact
 * complaint this whole mode exists to fix. So only a complete utterance that
 * is *nothing but* a sign-off counts. "No" ends it; "no, what about Ukraine?"
 * does not, despite starting with the same word.
 */

const CLOSERS = new Set([
    'no', 'nope', 'nah', 'no thanks', 'no thank you',
    'nothing', 'nothing else', 'no nothing else',
    "that's all", 'thats all', "that's it", 'thats it',
    "that's everything", 'thats everything', "that's fine", 'thats fine',
    "i'm done", 'im done', "i'm good", 'im good', "i'm fine", 'im fine',
    "we're done", 'were done', 'done', 'all done',
    'stop', 'exit', 'quit', 'close', 'end', 'finish',
    'goodbye', 'good bye', 'bye', 'bye bye', 'see you', 'see ya',
    'thanks', 'thank you', 'thanks a lot', 'thank you very much', 'cheers',
    "no i'm good", 'no im good', "no that's all", 'no thats all',
]);

// Fillers people open with. "Um, no thanks" is a sign-off; the "um" should
// not stop it being recognised as one.
const OPENING_FILLER = /^(um+|uh+|er+|erm+|okay|ok|alright|alrighty|right|well|so|yeah|yes)\s+/;

// A trailing farewell ends it whatever came before: "ok thanks, bye".
const CLOSING_TAIL = /\b(bye|goodbye|good night|goodnight)\s*$/;

/** Reduce an utterance to comparable words, keeping apostrophes. */
const normalise = (text) =>
    String(text || '')
        .toLowerCase()
        .replace(/[^a-z\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export function isFarewell(text) {
    const cleaned = normalise(text);
    if (!cleaned) return false;
    if (CLOSERS.has(cleaned)) return true;
    if (CLOSING_TAIL.test(cleaned)) return true;

    const withoutFiller = cleaned.replace(OPENING_FILLER, '').trim();
    return Boolean(withoutFiller) && CLOSERS.has(withoutFiller);
}

/**
 * How many times the microphone may open to silence before giving up.
 *
 * One is too few: a pause to think reads as silence, and closing on it sends
 * the reader back to the button. Two consecutive is a clear signal that
 * nobody is there.
 */
export const SILENT_TURNS_BEFORE_CLOSING = 2;

export const SIGN_OFF = 'Goodbye.';
