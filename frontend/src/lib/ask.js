/**
 * The Ask page's logic, kept out of the component so it can be tested.
 *
 * Everything here is a pure function over data the API already returns. That
 * is the point of most of it: the assistant reports which tools it ran, how
 * many articles it drew on and why an answer is missing, and until now the
 * page threw all of it away and rendered a paragraph.
 */

/** Trim to a word boundary, so a chip is not a headline with a hard edge. */
export function shorten(text = '', limit = 52) {
    const clean = String(text).replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const cut = clean.slice(0, limit);
    const space = cut.lastIndexOf(' ');
    return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:—-]$/, '')}…`;
}

// ── What the assistant actually did ──────────────────────
//
// The answer says what it found; this says where it looked. An assistant that
// cannot be checked is worse than none, and "it searched the archive twice and
// read Colombia's standing" is a stronger claim to trust than any wording the
// model could choose for itself.
const TOOL_LABELS = {
    search_news: 'searched the archive',
    country_briefing: 'read a country’s standing',
    major_events: 'ranked the biggest events',
    escalating_countries: 'compared risk movement',
    refresh_feed: 'started a feed refresh',
    feed_status: 'checked the refresh',
};

/**
 * Human phrases for a list of tool names, in the order first used, with
 * repeats folded into a count rather than listed twice.
 */
export function describeTools(toolsUsed = []) {
    const counts = new Map();
    for (const name of toolsUsed) {
        const label = TOOL_LABELS[name];
        if (!label) continue;                    // a tool this build has no wording for
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
}

// ── Why an answer is missing ─────────────────────────────
//
// Three tones, because three different things are being said: wait a moment,
// this server needs its operator, or ask differently. They were one red box.
const TONE_BY_KIND = {
    busy: 'wait',
    limit: 'wait',
    config: 'fault',
    upstream: 'fault',
    input: 'nudge',
};

// A frontend can outlive the backend it was built against, and a deploy where
// only one side has moved should not lose the distinction entirely. Read the
// kind when it is there; fall back to the wording when it is not.
const FALLBACK_PATTERNS = [
    [/limit|budget|too much|a lot in a short time|busy|try again/i, 'wait'],
    [/not configured|api key|unreachable|unreadable/i, 'fault'],
    [/narrower|ask a question/i, 'nudge'],
];

export function errorTone(kind, message = '') {
    if (kind && TONE_BY_KIND[kind]) return TONE_BY_KIND[kind];
    const hit = FALLBACK_PATTERNS.find(([pattern]) => pattern.test(message));
    return hit ? hit[1] : 'fault';
}

// ── Openers ──────────────────────────────────────────────

/** Shown before anything has been asked, when the live board is unavailable. */
export const FALLBACK_SUGGESTIONS = [
    'What happened in Colombia recently?',
    'Which countries are escalating right now?',
    'What is the biggest story this week?',
    'How risky is Ukraine at the moment?',
];

/**
 * Opening questions built from what the site is actually holding right now.
 *
 * A fixed list asks "what is the biggest story this week?" of a site that
 * already knows the answer, and reads as decoration. These name the countries
 * and events the archive can genuinely say something about, which also teaches
 * the reader what kind of question works here.
 */
export function buildSuggestions({ movers, events } = {}, limit = 4) {
    const out = [];
    const seenCountry = new Set();
    const add = (text, country) => {
        if (!text || out.includes(text) || out.length >= limit) return;
        if (country) {
            if (seenCountry.has(country)) return;   // one question per country
            seenCountry.add(country);
        }
        out.push(text);
    };

    const rising = movers?.rising?.[0]?.country;
    add(rising && `Why is ${rising} escalating?`, rising);

    const event = events?.[0];
    if (event?.title) add(`What is the latest on ${shorten(event.title, 46)}?`);

    const falling = movers?.falling?.[0]?.country;
    add(falling && `What has calmed down in ${falling}?`, falling);

    const second = movers?.rising?.[1]?.country;
    add(second && `What is happening in ${second}?`, second);

    for (const fallback of FALLBACK_SUGGESTIONS) add(fallback);
    return out.slice(0, limit);
}

// ── Where to go next ─────────────────────────────────────
const TOPIC_WORDS = {
    military: 'military',
    diplomatic: 'diplomatic',
    economic: 'economic',
    political: 'political',
    hazard: 'disaster',
};

const commonest = (values) => {
    const counts = new Map();
    for (const value of values) {
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
        if (count > bestCount) { best = value; bestCount = count; }
    }
    return best;
};

/**
 * Follow-ups derived from the articles an answer actually used.
 *
 * No extra model call: the countries and topics are already sitting in the
 * sources, and a reader who just asked about a place usually wants either its
 * standing or the rest of its coverage next.
 */
export function buildFollowUps(turn, limit = 3) {
    if (!turn?.answer || !turn.sources?.length) return [];

    const asked = (turn.question || '').toLowerCase();
    const out = [];
    const add = (text) => {
        // Never offer back the question that was just asked.
        if (text && !out.includes(text) && asked !== text.toLowerCase() && out.length < limit) {
            out.push(text);
        }
    };

    const country = commonest(turn.sources.map((s) => s.country));
    if (country) {
        add(`How risky is ${country} at the moment?`);
        add(`What else has happened in ${country}?`);
    }

    const topic = TOPIC_WORDS[commonest(turn.sources.map((s) => s.topic))];
    if (topic) add(`What other ${topic} stories are in the archive?`);

    return out;
}

// ── Reading an answer that formatted itself ──────────────
//
// Answers are rendered as plain paragraphs on purpose: turning a model's
// output into markup is a needless risk. But a model asked for labelled lines
// writes them in markdown, and "**What is happening**" rendered literally is
// its own kind of wrong.
//
// So the markup is parsed here into data — runs of text and whether each is
// emphasised — and the caller builds React elements from it. No HTML is
// produced at any point, so this cannot inject anything however the model
// chooses to format itself.

const BULLET = /^\s*[-*•]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

/** Split a line into `{ text, strong }` runs on `**bold**` markers. */
export function segmentEmphasis(line = '') {
    const out = [];
    const pattern = /\*\*(.+?)\*\*/g;
    let last = 0;
    let match = pattern.exec(line);
    while (match) {
        if (match.index > last) out.push({ text: line.slice(last, match.index), strong: false });
        out.push({ text: match[1], strong: true });
        last = match.index + match[0].length;
        match = pattern.exec(line);
    }
    if (last < line.length) out.push({ text: line.slice(last), strong: false });
    return out.filter((run) => run.text !== '');
}

/**
 * An answer as lines to render: a bullet, a heading, or a paragraph, each
 * already split into emphasised runs.
 */
export function readableLines(answer = '') {
    return answer
        .split('\n')
        .map((raw) => raw.trim())
        // A line holding nothing but its own markers is not content: a stray
        // "-" from an interrupted list should not render as a bullet of one
        // dash.
        .filter((line) => line && !/^[-*•#\s]+$/.test(line))
        .map((line) => {
            const heading = HEADING.exec(line);
            if (heading) return { kind: 'heading', runs: segmentEmphasis(heading[1]) };
            const bullet = BULLET.exec(line);
            if (bullet) return { kind: 'bullet', runs: segmentEmphasis(bullet[1]) };
            return { kind: 'paragraph', runs: segmentEmphasis(line) };
        })
        .filter((line) => line.runs.length > 0);
}

// ── Keeping a thread across a reload ─────────────────────

// Enough to keep a session's worth of context without letting one browser's
// storage grow without limit.
export const MAX_STORED_TURNS = 20;

/**
 * The turns worth writing down.
 *
 * A turn still in flight would come back from storage as a spinner that never
 * resolves, and a stopped one is something the reader already decided against.
 * Only settled turns survive a reload.
 */
export function storableTurns(turns = []) {
    return turns
        .filter((turn) => turn && !turn.cancelled && (turn.answer || turn.error))
        .slice(-MAX_STORED_TURNS);
}

// ── Taking an answer with you ────────────────────────────

/**
 * An answer as plain text, with its sources as links.
 *
 * The sources are the reason to trust it, so they travel with it — an answer
 * pasted somewhere else without them is exactly the unverifiable claim this
 * page exists to avoid.
 */
export function formatAnswerForCopy(turn, { origin = '' } = {}) {
    if (!turn?.answer) return '';
    const lines = [turn.question, '', turn.answer];

    if (!turn.fromArchive) {
        lines.push('', 'Answered from general knowledge, not this site’s archive.');
    }

    if (turn.sources?.length) {
        lines.push('', `Sources (${turn.sources.length})`);
        for (const source of turn.sources) {
            const link = source.id && origin ? ` — ${origin}/story/${source.id}` : '';
            lines.push(`- ${source.source || 'Unknown'} · ${source.title}${link}`);
        }
    }
    return lines.join('\n');
}
