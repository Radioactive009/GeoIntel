import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFollowUps,
    buildSuggestions,
    describeTools,
    errorTone,
    formatAnswerForCopy,
    readableLines,
    segmentEmphasis,
    shorten,
    storableTurns,
    FALLBACK_SUGGESTIONS,
    MAX_STORED_TURNS,
} from './ask.js';

test('repeated tools are counted, not listed twice', () => {
    assert.deepEqual(
        describeTools(['search_news', 'search_news', 'country_briefing']),
        ['searched the archive ×2', 'read a country’s standing'],
    );
});

test('a tool this build has no wording for is dropped rather than shown raw', () => {
    assert.deepEqual(describeTools(['search_news', 'some_future_tool']), ['searched the archive']);
    assert.deepEqual(describeTools([]), []);
    assert.deepEqual(describeTools(undefined), []);
});

test('waiting, broken and rephrase-this are told apart', () => {
    assert.equal(errorTone('busy'), 'wait');
    assert.equal(errorTone('limit'), 'wait');
    assert.equal(errorTone('config'), 'fault');
    assert.equal(errorTone('upstream'), 'fault');
    assert.equal(errorTone('input'), 'nudge');
});

// A frontend built against a newer backend than it is deployed with still has
// to tell "come back later" from "this is broken".
test('the wording is read when the server sends no kind', () => {
    assert.equal(errorTone(null, 'You have asked a lot in a short time.'), 'wait');
    assert.equal(errorTone(null, 'The assistant is not configured on this server.'), 'fault');
    assert.equal(errorTone(null, 'Try asking something narrower.'), 'nudge');
    assert.equal(errorTone(null, 'Could not reach the assistant.'), 'fault');
});

test('openers name what the archive is actually holding', () => {
    const suggestions = buildSuggestions({
        movers: { rising: [{ country: 'Mali' }], falling: [{ country: 'Peru' }] },
        events: [{ title: 'Ceasefire talks collapse as strikes resume across the border region' }],
    });
    assert.equal(suggestions.length, 4);
    assert.ok(suggestions.some((s) => s.includes('Mali')));
    assert.ok(suggestions.some((s) => s.includes('Peru')));
    assert.ok(suggestions.some((s) => s.startsWith('What is the latest on Ceasefire talks')));
});

test('one question per country, however the board is shaped', () => {
    const suggestions = buildSuggestions({
        movers: { rising: [{ country: 'Mali' }, { country: 'Mali' }], falling: [{ country: 'Mali' }] },
    });
    assert.equal(suggestions.filter((s) => s.includes('Mali')).length, 1);
});

test('an empty board falls back rather than showing nothing', () => {
    assert.deepEqual(buildSuggestions({}), FALLBACK_SUGGESTIONS);
    assert.deepEqual(buildSuggestions(), FALLBACK_SUGGESTIONS);
    assert.deepEqual(buildSuggestions({ movers: { rising: [], falling: [] }, events: [] }),
        FALLBACK_SUGGESTIONS);
});

test('follow-ups come from the countries the answer actually used', () => {
    const followUps = buildFollowUps({
        question: 'What happened in Sudan?',
        answer: 'Several outlets report…',
        sources: [
            { country: 'Sudan', topic: 'military' },
            { country: 'Sudan', topic: 'military' },
            { country: 'Chad', topic: 'diplomatic' },
        ],
    });
    assert.ok(followUps.every((f) => !f.includes('Chad')));
    assert.ok(followUps.some((f) => f.includes('How risky is Sudan')));
    assert.ok(followUps.some((f) => f.includes('military')));
});

test('nothing to follow up on without an answer or sources', () => {
    assert.deepEqual(buildFollowUps({ question: 'x', sources: [{ country: 'Sudan' }] }), []);
    assert.deepEqual(buildFollowUps({ question: 'x', answer: 'y', sources: [] }), []);
    assert.deepEqual(buildFollowUps(null), []);
});

test('a follow-up never offers back the question just asked', () => {
    const followUps = buildFollowUps({
        question: 'How risky is Sudan at the moment?',
        answer: 'Fairly.',
        sources: [{ country: 'Sudan' }],
    });
    assert.ok(!followUps.includes('How risky is Sudan at the moment?'));
});

test('a copied answer carries its sources', () => {
    const text = formatAnswerForCopy({
        question: 'What happened in Sudan?',
        answer: 'Two outlets report shelling.',
        fromArchive: true,
        sources: [{ id: 12, source: 'Reuters', title: 'Shelling resumes' }],
    }, { origin: 'https://example.org' });

    assert.ok(text.includes('What happened in Sudan?'));
    assert.ok(text.includes('Two outlets report shelling.'));
    assert.ok(text.includes('- Reuters · Shelling resumes — https://example.org/story/12'));
});

test('a copied answer admits when it did not come from the archive', () => {
    const text = formatAnswerForCopy({
        question: 'When was NATO founded?',
        answer: '1949.',
        fromArchive: false,
        sources: [],
    });
    assert.match(text, /general knowledge/);
    assert.equal(formatAnswerForCopy({ question: 'x' }), '');
});

test('emphasis becomes data, never markup', () => {
    assert.deepEqual(segmentEmphasis('**Why it matters** – the strait is narrow'), [
        { text: 'Why it matters', strong: true },
        { text: ' – the strait is narrow', strong: false },
    ]);
    assert.deepEqual(segmentEmphasis('plain text'), [{ text: 'plain text', strong: false }]);
    assert.deepEqual(segmentEmphasis(''), []);
});

test('an unclosed marker is left alone rather than eating the line', () => {
    assert.deepEqual(segmentEmphasis('**not closed'), [{ text: '**not closed', strong: false }]);
});

// The reason this parses to data rather than producing HTML: whatever the
// model emits, it can only ever become text in a React element.
test('markup in an answer stays inert', () => {
    assert.deepEqual(segmentEmphasis('<img src=x onerror=alert(1)>'), [
        { text: '<img src=x onerror=alert(1)>', strong: false },
    ]);
});

test('an answer becomes headings, bullets and paragraphs', () => {
    const lines = readableLines('## Context\n- **First** point\n\nA closing paragraph.');
    assert.deepEqual(lines.map((l) => l.kind), ['heading', 'bullet', 'paragraph']);
    assert.deepEqual(lines[0].runs, [{ text: 'Context', strong: false }]);
    assert.equal(lines[1].runs[0].text, 'First');
    assert.equal(lines[1].runs[0].strong, true);
});

test('blank and marker-only lines are dropped', () => {
    assert.deepEqual(readableLines('\n\n   \n'), []);
    assert.deepEqual(readableLines(''), []);
    assert.deepEqual(readableLines('- '), []);
});

// A turn with neither an answer nor an error was still in flight when the page
// went away; restored, it is a spinner with nothing behind it.
test('only settled turns are kept for the next visit', () => {
    const kept = storableTurns([
        { question: 'answered', answer: 'yes' },
        { question: 'in flight' },
        { question: 'failed', error: 'nope' },
        { question: 'stopped', cancelled: true },
    ]);
    assert.deepEqual(kept.map((t) => t.question), ['answered', 'failed']);
});

test('a long thread is capped rather than growing without limit', () => {
    const many = Array.from({ length: MAX_STORED_TURNS + 8 }, (_, i) => ({ question: `q${i}`, answer: 'a' }));
    const kept = storableTurns(many);
    assert.equal(kept.length, MAX_STORED_TURNS);
    // The most recent are the ones worth keeping.
    assert.equal(kept.at(-1).question, `q${many.length - 1}`);
    assert.deepEqual(storableTurns([]), []);
    assert.deepEqual(storableTurns(), []);
});

test('shortening keeps whole words', () => {
    assert.equal(shorten('a short one', 40), 'a short one');
    assert.equal(shorten('Ceasefire talks collapse as strikes resume', 20), 'Ceasefire talks…');
    assert.equal(shorten('  spaced   out  text ', 40), 'spaced out text');
});
