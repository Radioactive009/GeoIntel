import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMorphTargets, normalise, VISEMES, JAW, BLINK } from './morphTargets.js';

const mesh = (name) => ({ name });
const dict = (...keys) => Object.fromEntries(keys.map((k, i) => [k, i]));

test('resolves bare ARKit and Oculus names', () => {
    const morphs = [{ mesh: mesh('Head'), dictionary: dict('viseme_aa', 'viseme_O', 'jawOpen', 'eyeBlinkLeft') }];
    assert.equal(resolveMorphTargets(morphs, VISEMES).length, 2);
    assert.equal(resolveMorphTargets(morphs, JAW).length, 1);
    assert.equal(resolveMorphTargets(morphs, BLINK).length, 1);
});

test('a mesh prefix or different casing does not defeat the lookup', () => {
    // The failure this guards is silent: the head loads and never moves its
    // mouth, which reads as broken animation rather than a broken lookup.
    const morphs = [{ mesh: mesh('Head'), dictionary: dict('Wolf3D_Head.JawOpen', 'head_Viseme_AA', 'Eye_Blink_Left') }];
    assert.equal(resolveMorphTargets(morphs, JAW).length, 1);
    assert.equal(resolveMorphTargets(morphs, VISEMES).length, 1);
    assert.equal(resolveMorphTargets(morphs, BLINK).length, 1);
});

test('a shape split across meshes drives all of them', () => {
    const morphs = [
        { mesh: mesh('Head'), dictionary: dict('jawOpen', 'viseme_aa') },
        { mesh: mesh('Teeth'), dictionary: dict('jawOpen') },
    ];
    assert.equal(resolveMorphTargets(morphs, JAW).length, 2);
});

test('near-miss names are rejected', () => {
    // A wrong shape moving is worse than none moving.
    const morphs = [{ mesh: mesh('Head'), dictionary: dict('viseme_aa_extra', 'mouthClose', 'eyeBlinkLeftInner') }];
    assert.equal(resolveMorphTargets(morphs, VISEMES).length, 0);
    assert.equal(resolveMorphTargets(morphs, JAW).length, 0);
    assert.equal(resolveMorphTargets(morphs, BLINK).length, 0);
});

test('a model with no morph targets resolves to nothing', () => {
    assert.equal(resolveMorphTargets([], VISEMES).length, 0);
    assert.equal(resolveMorphTargets([{ mesh: mesh('X'), dictionary: {} }], JAW).length, 0);
});

test('normalise strips case and punctuation', () => {
    assert.equal(normalise('Wolf3D_Head.JawOpen'), 'wolf3dheadjawopen');
});
