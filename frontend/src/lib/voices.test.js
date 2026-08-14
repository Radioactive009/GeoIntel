import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVoice, pickVoice, moodOf, splitSentences, prosodyFor } from './voices.js';

const V = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });

test('picks a neural voice over the platform default', () => {
    // A real Windows + Chrome list: the good voice is not first, and the
    // browser's own default is the worst entry present.
    const installed = [
        V('Microsoft David - English (United States)'),
        V('Microsoft Zira - English (United States)'),
        V('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
        V('Google US English', 'en-US', false),
    ];
    assert.match(pickVoice(installed).name, /Natural/);
});

test('prefers a bundled Google voice over eSpeak', () => {
    assert.match(pickVoice([V('espeak-ng'), V('Google UK English Male', 'en-GB', false)]).name, /Google/);
});

test('ranks the old SAPI voices below an unknown one', () => {
    assert.ok(rankVoice(V('Microsoft David')) < rankVoice(V('Some Unknown Voice')));
});

test('rejects voices that cannot read the answer', () => {
    assert.equal(rankVoice(V('Google Deutsch', 'de-DE')), -1);
    assert.equal(rankVoice(V('Nameless', '')), -1);
});

test('accepts every English variant, not just en-US', () => {
    assert.ok(rankVoice(V('Daniel', 'en-GB')) > 0);
    assert.ok(rankVoice(V('Something', 'en')) > 0);
});

test('an empty voice list is null rather than a crash', () => {
    assert.equal(pickVoice([]), null);
    assert.equal(pickVoice(undefined), null);
});

test('mood follows what the answer says', () => {
    assert.equal(moodOf('An earthquake killed 200 people.'), 'serious');
    assert.equal(moodOf('The ceasefire held overnight.'), 'uplifting');
    assert.equal(moodOf('The committee met on Tuesday.'), 'neutral');
    // Good words next to grim ones must not brighten the delivery.
    assert.equal(moodOf('Aid arrived after the bombing killed dozens.'), 'serious');
});

test('grim news is read slower and lower than good news', () => {
    const grim = prosodyFor('Dozens were killed.', { mood: 'serious', index: 0 });
    const glad = prosodyFor('The truce held.', { mood: 'uplifting', index: 0 });
    assert.ok(grim.rate < glad.rate);
    assert.ok(grim.pitch < glad.pitch);
});

test('questions rise at the end', () => {
    assert.ok(prosodyFor('Is that so?', { index: 0 }).pitch > prosodyFor('That is so.', { index: 0 }).pitch);
});

test('successive sentences differ, but a replay is identical', () => {
    const a = prosodyFor('A sentence of moderate length.', { index: 0 });
    const b = prosodyFor('A sentence of moderate length.', { index: 1 });
    assert.notEqual(a.rate, b.rate, 'consecutive sentences must not be metronomic');
    assert.deepEqual(prosodyFor('X.', { index: 3 }), prosodyFor('X.', { index: 3 }));
});

test('rate and pitch stay speakable across every input', () => {
    for (let i = 0; i < 60; i += 1) {
        const p = prosodyFor('word '.repeat(i * 4), { mood: i % 2 ? 'serious' : 'uplifting', index: i });
        assert.ok(p.rate >= 0.6 && p.rate <= 1.5, `rate ${p.rate}`);
        assert.ok(p.pitch >= 0.5 && p.pitch <= 1.6, `pitch ${p.pitch}`);
    }
});

test('splits sentences', () => {
    assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
    assert.deepEqual(splitSentences(''), []);
});
