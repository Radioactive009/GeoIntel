/**
 * Making the browser's own speech synthesis sound less like a machine.
 *
 * Two things make the default sound robotic, and neither is the API's fault.
 *
 * The first is voice choice. `getVoices()` returns whatever the platform has
 * installed, and the entry the browser picks by default is frequently the
 * oldest and flattest one present — Microsoft David, or an eSpeak fallback —
 * while a modern neural voice sits further down the same list unused.
 *
 * The second is that one utterance for a whole answer is delivered at a single
 * fixed rate and pitch from beginning to end. Real speech varies per sentence.
 * Splitting the text and shifting the prosody a little each time costs nothing
 * and is most of the difference between reading and reciting.
 *
 * This is the free path. Where the server has Orpheus configured the audio
 * comes from there instead and none of this runs — but that is billed per
 * character, so this is what nearly everyone will actually hear.
 */

// Neural voices, roughly best first. Matched against the voice name, which is
// the only signal the API exposes about quality.
const QUALITY_MARKERS = [
    [/natural/i, 100],        // "Microsoft Aria Online (Natural)" and siblings
    [/neural/i, 90],
    [/\bgoogle\b/i, 70],      // Chrome's bundled voices, better than SAPI
    [/premium|enhanced/i, 60],
    [/samantha|daniel|karen|moira|serena|alex\b/i, 40],   // decent macOS voices
];

// Old SAPI5 and eSpeak voices. Present nearly everywhere on Windows and Linux
// respectively, and the usual reason the default sounds like a train station.
const POOR_MARKERS = [/espeak/i, /\bdavid\b/i, /\bzira\b/i, /\bmark\b/i, /pico/i];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function rankVoice(voice) {
    if (!voice || !/^en\b|^en[-_]/i.test(voice.lang || '')) return -1;

    let score = 10;
    QUALITY_MARKERS.forEach(([pattern, points]) => {
        if (pattern.test(voice.name)) score = Math.max(score, points);
    });
    if (POOR_MARKERS.some((pattern) => pattern.test(voice.name))) score -= 30;

    // Remote voices are usually the neural ones; local voices are usually the
    // bundled fallbacks. A weak signal, so it only breaks ties.
    if (voice.localService === false) score += 5;
    // en-GB and en-US ahead of regional variants the answer text is not in.
    if (/^en-(GB|US)$/i.test(voice.lang)) score += 3;
    return score;
}

/** The best English voice available, or null to let the browser decide. */
export function pickVoice(voices) {
    if (!voices || !voices.length) return null;
    let best = null;
    let bestScore = 0;
    voices.forEach((voice) => {
        const score = rankVoice(voice);
        if (score > bestScore) { best = voice; bestScore = score; }
    });
    return best;
}

// Deliberately small. The server classifies tone properly with the same
// lexicon the articles use; this only has to steer the fallback voice, and a
// second full copy of that vocabulary in the bundle would be worse than a
// rough guess made in a few hundred bytes.
const GRIM = /\b(kill|killed|dead|death|toll|casualt|wounded|strike|shelling|bomb|attack|war|invasion|famine|quake|flood|crisis|collapse|sanction|evacuat)/i;
const GOOD = /\b(ceasefire|truce|peace deal|agreement|released|freed|rescued|recovery|aid|treaty|breakthrough|reopened|restored)/i;

export function moodOf(text = '') {
    if (GOOD.test(text) && !GRIM.test(text)) return 'uplifting';
    if (GRIM.test(text)) return 'serious';
    return 'neutral';
}

/** Split into sentences, so each can be delivered slightly differently. */
export function splitSentences(text = '') {
    return String(text)
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Rate and pitch for one sentence.
 *
 * The drift term is derived from the sentence's position rather than randomly:
 * successive sentences need to differ from each other, but the same answer
 * replayed should not sound different, and a test cannot assert on Math.random.
 */
export function prosodyFor(sentence = '', { mood = 'neutral', index = 0 } = {}) {
    let rate = 1.0;
    let pitch = 1.0;

    if (mood === 'serious') { rate = 0.93; pitch = 0.93; }
    else if (mood === 'uplifting') { rate = 1.05; pitch = 1.07; }

    if (/\?\s*$/.test(sentence)) pitch += 0.07;      // questions rise at the end
    if (sentence.length < 40) rate += 0.03;          // short lines move quicker
    if (sentence.length > 160) rate -= 0.03;         // long ones need room

    const drift = (((index * 37) % 7) - 3) / 100;    // -0.03 .. 0.03, stable
    return {
        rate: clamp(rate + drift, 0.6, 1.5),
        pitch: clamp(pitch + drift, 0.5, 1.6),
    };
}
