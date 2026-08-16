import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, bcp47For, isSupportedLanguage, voicePrefixFor } from './languages.js';

test('every language carries the three shapes the stack needs', () => {
    for (const entry of LANGUAGES) {
        assert.ok(entry.code, 'a code for the server');
        assert.ok(entry.label, 'a label for the reader');
        // "Detect" is the one entry with no tag: the browser has no such mode.
        if (entry.code !== 'auto') assert.match(entry.bcp47, /^[a-z]{2}-[A-Z]{2}$/);
    }
});

test('detect falls back to whatever the browser is set to', () => {
    assert.equal(bcp47For('auto', 'fr-CA'), 'fr-CA');
    assert.equal(voicePrefixFor('auto', 'fr-CA'), 'fr');
});

test('an unknown or missing code never yields an empty tag', () => {
    assert.equal(bcp47For('kl', 'es-ES'), 'es-ES');
    assert.equal(bcp47For('auto', ''), 'en-US');
    assert.equal(bcp47For(undefined), 'en-US');
});

test('known codes map to their own tag regardless of the browser', () => {
    assert.equal(bcp47For('ja', 'fr-CA'), 'ja-JP');
    assert.equal(voicePrefixFor('ja', 'fr-CA'), 'ja');
    assert.ok(isSupportedLanguage('hi'));
    assert.ok(!isSupportedLanguage('xx'));
});
