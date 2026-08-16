import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_NOTES, MAX_NOTE_CHARS, briefToMarkdown, isSaved, normaliseNotes, notesToMarkdown, toNote,
} from './studyNotes.js';

test('a saved story keeps what is needed to trace it later', () => {
    const note = toNote({
        id: 12, title: 'Talks resume', source: 'Reuters', country: 'India',
        topic: 'diplomacy', published: '2026-08-01',
    }, { note: 'Compare with the 2023 round.' });

    assert.equal(note.kind, 'story');
    assert.equal(note.id, '12', 'ids are strings, so a URL param compares equal');
    assert.equal(note.source, 'Reuters');
    assert.equal(note.note, 'Compare with the 2023 round.');
});

test('an over-long note is trimmed rather than stored whole', () => {
    const note = toNote({ id: 1, title: 'x' }, { note: 'a'.repeat(MAX_NOTE_CHARS + 500) });
    assert.equal(note.note.length, MAX_NOTE_CHARS);
});

test('saving the same story twice keeps one entry', () => {
    const notes = normaliseNotes([
        { kind: 'story', id: '1', title: 'newer' },
        { kind: 'story', id: '1', title: 'older' },
        { kind: 'event', id: '1', title: 'a different kind' },
    ]);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].title, 'newer', 'the newest wins');
});

test('the collection is capped and junk is dropped', () => {
    const many = Array.from({ length: MAX_NOTES + 20 }, (_, i) => ({ kind: 'story', id: String(i) }));
    assert.equal(normaliseNotes(many).length, MAX_NOTES);
    assert.deepEqual(normaliseNotes([null, {}, { title: 'no id' }]), []);
    assert.deepEqual(normaliseNotes(), []);
});

test('saved state is answerable for a given story', () => {
    const notes = [{ kind: 'story', id: '12' }];
    assert.ok(isSaved(notes, 'story', 12), 'a numeric id from a route still matches');
    assert.ok(!isSaved(notes, 'event', 12));
    assert.ok(!isSaved([], 'story', 12));
});

test('exported notes group by country and keep their attribution', () => {
    const md = notesToMarkdown([
        { kind: 'story', id: '3', title: 'Border talks', source: 'The Hindu', country: 'India', published: '2026-08-02', note: 'Line one\nLine two' },
        { kind: 'event', id: 'ev_1', title: 'Strait closure', source: '', country: 'Iran', published: '' },
    ], { origin: 'https://example.org' });

    assert.match(md, /## India/);
    assert.match(md, /## Iran/);
    assert.match(md, /\[Border talks\]\(https:\/\/example\.org\/story\/3\)/);
    assert.match(md, /\[Strait closure\]\(https:\/\/example\.org\/event\/ev_1\)/, 'events link to events');
    assert.match(md, /The Hindu · 2026-08-02/);
    assert.match(md, /> Line one/);
    assert.match(md, /> Line two/, 'a multi-line note stays quoted throughout');
    assert.equal(notesToMarkdown([]), '');
});

test('a story with no country is filed rather than dropped', () => {
    assert.match(notesToMarkdown([{ kind: 'story', id: '1', title: 'Somewhere' }]), /## Unfiled/);
});

test('an exported brief carries the counts behind every claim', () => {
    const md = briefToMarkdown({
        summary: 'A quiet week.',
        coverage: { articles: 120, outlets: 14, countries: 30 },
        events: [
            { event_key: 'ev_a', title: 'Ceasefire holds', reports: 9, outlets: 6, countries: ['Israel'], topic: 'conflict', figures: { deaths: 40 } },
            { event_key: 'ev_b', title: 'Tariffs raised', reports: 4, outlets: 3, countries: ['China'], topic: 'economy', figures: {} },
        ],
        escalating: [{ country: 'Mali', baseline: 40, current: 61, sigma: 2.4 }],
        contested: [{ event_key: 'ev_a', title: 'Ceasefire holds', outlets: 6, spread: 12.5, consensus: 55 }],
    }, { origin: 'https://example.org', label: 'last 30 days' });

    assert.match(md, /# What to know — last 30 days/);
    assert.match(md, /Drawn from 120 reports across 14 outlets and 30 countries/);
    assert.match(md, /## Conflict/);
    assert.match(md, /## Economy/, 'events are grouped by topic, not listed flat');
    assert.match(md, /9 reports · 6 outlets · Israel · 40 deaths/);
    assert.match(md, /\*\*Mali\*\* 40 → 61 \(\+2\.4σ\)/);
    assert.match(md, /## Where outlets disagreed/);
    assert.equal(briefToMarkdown(null), '');
});

test('one report is not "1 reports"', () => {
    const md = briefToMarkdown({ events: [{ event_key: 'e', title: 'T', reports: 1, outlets: 1, topic: 'other' }] });
    assert.match(md, /1 report · 1 outlet\b/);
});
