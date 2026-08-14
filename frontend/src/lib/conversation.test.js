import test from 'node:test';
import assert from 'node:assert/strict';
import { isFarewell, SILENT_TURNS_BEFORE_CLOSING, SIGN_OFF } from './conversation.js';

// Ending a conversation someone wanted to continue sends them back to the
// button, which is the annoyance hands-free mode exists to remove. These two
// groups are the whole contract.
const ENDS = [
    'no', 'No.', 'nope', 'nah', 'no thanks', 'No thank you.', 'nothing else',
    "that's all", 'thats all', "that's it", "I'm done", 'im good', "we're done",
    'stop', 'exit', 'quit', 'goodbye', 'bye', 'Bye bye!', 'see you',
    'thanks', 'Thank you.', 'cheers',
    'um, no thanks', 'okay thanks bye', 'ok, bye', "alright, that's all", 'yeah no thanks',
];

const CONTINUES = [
    'no, what about Ukraine?', 'no i meant India', 'stop the war in Sudan',
    'thanks, and what about China?', 'bye elections in Kenya',
    'what is happening in Gaza', 'tell me more', 'and Russia?',
    'is that all the outlets reported?', 'no thanks to the sanctions, what changed?',
    'done deals in the region', 'what does that mean', 'who said that', '', '   ',
];

test('a bare sign-off ends the conversation', () => {
    for (const phrase of ENDS) {
        assert.equal(isFarewell(phrase), true, `should end on ${JSON.stringify(phrase)}`);
    }
});

test('a sign-off word inside a real question does not', () => {
    for (const phrase of CONTINUES) {
        assert.equal(isFarewell(phrase), false, `should continue on ${JSON.stringify(phrase)}`);
    }
});

test('degenerate input is not a farewell and does not throw', () => {
    for (const value of [null, undefined, 123, {}]) {
        assert.equal(isFarewell(value), false);
    }
});

test('silence is given more than one chance', () => {
    // One is too few: a pause to think reads as silence.
    assert.ok(SILENT_TURNS_BEFORE_CLOSING >= 2);
});

test('the sign-off is short enough to not be a speech', () => {
    assert.equal(typeof SIGN_OFF, 'string');
    assert.ok(SIGN_OFF.length > 0 && SIGN_OFF.length < 40);
});
