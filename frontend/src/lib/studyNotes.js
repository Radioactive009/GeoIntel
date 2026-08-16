/**
 * Saved stories, and what gets written down about them.
 *
 * A reader following a running story for months needs somewhere to put it. The
 * shaping and rendering live here, apart from storage and React, because the
 * part worth testing is what a note becomes when it leaves the site — a person
 * revising from an export needs the source and the date beside the claim, or
 * the note is just an unattributed assertion in a text file.
 */

export const MAX_NOTES = 300;
export const MAX_NOTE_CHARS = 2000;

/** A saved entry from an article or event, with room for the reader's own words. */
export function toNote(item, { note = '', savedAt } = {}) {
    return {
        kind: item.kind || 'story',
        id: String(item.id),
        title: item.title || 'Untitled',
        source: item.source || '',
        country: item.country || '',
        topic: item.topic || '',
        published: item.published || '',
        note: String(note).slice(0, MAX_NOTE_CHARS),
        savedAt: savedAt || '',
    };
}

const keyOf = (note) => `${note.kind}:${note.id}`;

/** Newest first, one entry per story, capped. */
export function normaliseNotes(notes = []) {
    const seen = new Set();
    const out = [];
    for (const note of notes) {
        if (!note?.id) continue;
        const key = keyOf(note);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(note);
    }
    return out.slice(0, MAX_NOTES);
}

export const isSaved = (notes, kind, id) =>
    notes.some((note) => note.kind === kind && note.id === String(id));

const linkFor = (note, origin) => {
    if (!origin) return '';
    return note.kind === 'event' ? `${origin}/event/${note.id}` : `${origin}/story/${note.id}`;
};

/**
 * Saved notes as Markdown.
 *
 * Grouped by country, because that is how this material gets revised — and
 * every entry keeps its outlet and date, so a claim can still be traced back
 * once it is sitting in someone else's document.
 */
export function notesToMarkdown(notes = [], { origin = '', title = 'Saved stories' } = {}) {
    if (!notes.length) return '';
    const groups = new Map();
    for (const note of notes) {
        const group = note.country || 'Unfiled';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(note);
    }

    const lines = [`# ${title}`, ''];
    for (const [country, entries] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
        lines.push(`## ${country}`, '');
        for (const entry of entries) {
            const link = linkFor(entry, origin);
            lines.push(link ? `- **[${entry.title}](${link})**` : `- **${entry.title}**`);
            const meta = [entry.source, entry.published].filter(Boolean).join(' · ');
            if (meta) lines.push(`  ${meta}`);
            if (entry.note) {
                for (const line of entry.note.split('\n').filter(Boolean)) lines.push(`  > ${line}`);
            }
            lines.push('');
        }
    }
    return lines.join('\n').trimEnd();
}

/**
 * A brief as Markdown, for revision away from the site.
 *
 * The counts travel with it. A compilation that says "widely reported" without
 * saying by how many outlets is the kind of claim this site exists not to
 * make, and that is no less true once it has been exported.
 */
export function briefToMarkdown(brief, { origin = '', label = '' } = {}) {
    if (!brief) return '';
    const lines = [`# What to know${label ? ` — ${label}` : ''}`, ''];

    if (brief.summary) lines.push(brief.summary, '');
    if (brief.coverage) {
        const { articles = 0, outlets = 0, countries = 0 } = brief.coverage;
        lines.push(`*Drawn from ${articles} reports across ${outlets} outlets and ${countries} countries.*`, '');
    }

    const byTopic = new Map();
    for (const event of brief.events || []) {
        const topic = event.topic || 'other';
        if (!byTopic.has(topic)) byTopic.set(topic, []);
        byTopic.get(topic).push(event);
    }

    for (const [topic, events] of byTopic) {
        lines.push(`## ${topic[0].toUpperCase()}${topic.slice(1)}`, '');
        for (const event of events) {
            const link = origin ? `${origin}/event/${event.event_key}` : '';
            lines.push(link ? `### [${event.title}](${link})` : `### ${event.title}`);
            const facts = [
                `${event.reports} report${event.reports === 1 ? '' : 's'}`,
                `${event.outlets} outlet${event.outlets === 1 ? '' : 's'}`,
                event.countries?.length ? event.countries.join(', ') : '',
                Object.entries(event.figures || {})
                    .map(([kind, value]) => `${value.toLocaleString()} ${kind}`)
                    .join(', '),
            ].filter(Boolean);
            lines.push(facts.join(' · '), '');
        }
    }

    if (brief.escalating?.length) {
        lines.push('## Risk rising fastest', '');
        for (const row of brief.escalating) {
            lines.push(`- **${row.country}** ${row.baseline} → ${row.current} (+${row.sigma}σ)`);
        }
        lines.push('');
    }

    if (brief.contested?.length) {
        lines.push('## Where outlets disagreed', '');
        for (const row of brief.contested) {
            const link = origin ? `${origin}/event/${row.event_key}` : '';
            lines.push(link ? `- [${row.title}](${link})` : `- ${row.title}`);
            lines.push(`  ${row.outlets} outlets · spread ${row.spread} around ${row.consensus}`);
        }
        lines.push('');
    }

    return lines.join('\n').trimEnd();
}
