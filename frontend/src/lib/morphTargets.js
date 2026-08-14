/**
 * Resolving blendshape names across exporters.
 *
 * Every avatar tool rigs the same ARKit and Oculus shapes under slightly
 * different strings: bare ("jawOpen"), prefixed by the mesh ("Wolf3D_Head.
 * jawOpen"), re-cased ("JawOpen"), or separated differently ("jaw_open").
 * Matching literally finds nothing on a perfectly well-rigged model, and the
 * failure is silent — the head loads and simply never moves its mouth, which
 * reads as a bug in the animation rather than in the lookup.
 */

// ARKit and Oculus shape names. Every one is optional: exporters rig
// different subsets, and a missing shape is skipped rather than assumed.
export const VISEMES = ['viseme_aa', 'viseme_O', 'viseme_E', 'viseme_I', 'viseme_U'];
export const JAW = ['jawOpen', 'mouthOpen'];
export const BLINK = ['eyeBlinkLeft', 'eyeBlinkRight', 'eyesClosed'];
export const SMILE = ['mouthSmileLeft', 'mouthSmileRight'];

export const normalise = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find every (mesh, index) pair driving one of `names`.
 *
 * `morphs` is a list of {mesh, dictionary}, one per mesh carrying morph
 * targets — a face is usually split across head, teeth and eyes, so the same
 * shape legitimately resolves to several meshes and all of them must move
 * together.
 *
 * Matching is on the normalised suffix so a mesh prefix does not defeat it.
 * Suffix rather than substring: "viseme_aa" must not be satisfied by
 * "viseme_aa_extra", which is a different shape.
 */
export function resolveMorphTargets(morphs, names) {
    const wanted = names.map(normalise);
    const hits = [];
    morphs.forEach(({ mesh, dictionary }) => {
        Object.entries(dictionary).forEach(([name, index]) => {
            const flat = normalise(name);
            if (wanted.some((w) => flat === w || flat.endsWith(w))) {
                hits.push({ mesh, index });
            }
        });
    });
    return hits;
}
