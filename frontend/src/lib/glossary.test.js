import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, TERMS, findTerms, termById } from './glossary.js';

test('every entry is complete and filed under a real category', () => {
    const ids = new Set();
    for (const term of TERMS) {
        assert.ok(term.id && !ids.has(term.id), `duplicate or missing id: ${term.id}`);
        ids.add(term.id);
        assert.ok(term.name, `${term.id} needs a name`);
        assert.ok(CATEGORIES[term.category], `${term.id} has category ${term.category}`);
        assert.ok(term.match?.length, `${term.id} needs something to match on`);
        assert.ok(term.what?.length > 40, `${term.id} needs a real explanation`);
    }
});

test('a headline naming a body finds it', () => {
    assert.deepEqual(findTerms('SCO summit opens in Astana').map((t) => t.id), ['sco']);
    assert.deepEqual(findTerms('Quad leaders meet in Tokyo').map((t) => t.id), ['quad']);
});

// The reason match lists are explicit rather than derived from names: a bare
// acronym inside a longer word is not a mention.
test('an acronym has to stand as its own word', () => {
    assert.deepEqual(findTerms('Surveying the quadrant of the field'), []);
    assert.deepEqual(findTerms('WHOLESALE prices climb'), []);
    assert.deepEqual(findTerms('Scores injured'), []);
});

// The bug this exists to prevent: a story about Indian politics was tagged
// with the World Health Organization because its description contained "who".
test('an acronym that is also an ordinary word needs its capitals', () => {
    assert.deepEqual(findTerms('Congress leaders who hit back at the PM'), []);
    assert.deepEqual(findTerms('WHO warns of outbreak').map((t) => t.id), ['who']);
    assert.deepEqual(findTerms('It is not clear who will lead'), []);
});

test('spelled-out names still ignore case', () => {
    assert.deepEqual(findTerms('the world health organization said').map((t) => t.id), ['who']);
    assert.deepEqual(findTerms('quad leaders meet').map((t) => t.id), ['quad']);
});

test('boundaries hold regardless of case rules', () => {
    assert.deepEqual(findTerms('NATO expands again').map((t) => t.id), ['nato']);
    assert.deepEqual(findTerms('Natomas county fair'), []);
    assert.deepEqual(findTerms('NATOesque posturing'), []);
});

test('several bodies in one headline all surface, once each', () => {
    const found = findTerms('At the G20, BRICS members pressed for IMF quota reform — IMF again');
    assert.deepEqual(found.map((t) => t.id).sort(), ['brics', 'g20', 'imf']);
});

test('title and description are searched together', () => {
    const found = findTerms('Talks stall', 'Delegates cited the Paris Agreement');
    assert.deepEqual(found.map((t) => t.id), ['paris-agreement']);
    assert.deepEqual(findTerms('', null, undefined), []);
});

test('the long form and the acronym reach the same entry', () => {
    assert.deepEqual(
        findTerms('Shanghai Cooperation Organisation meets').map((t) => t.id),
        findTerms('SCO meets').map((t) => t.id),
    );
});

test('entries are addressable by id', () => {
    assert.equal(termById('quad').name, 'Quad');
    assert.equal(termById('nope'), null);
});

// The most commonly examined fact about any of these is who is in them, and
// the answer for India is often "not a member".
test('India’s standing is recorded where it is a known trap', () => {
    for (const id of ['aukus', 'nsg', 'npt', 'ctbt', 'oecd', 'asean', 'nato', 'g7', 'opec']) {
        assert.match(termById(id).india, /[Nn]ot |has not/, `${id} should state India is outside it`);
    }
    for (const id of ['quad', 'brics', 'sco', 'bimstec', 'mtcr', 'i2u2']) {
        assert.match(termById(id).india, /member|party|Ratified|participant/i);
    }
});
