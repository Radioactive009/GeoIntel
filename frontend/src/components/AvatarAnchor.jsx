import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * A real avatar, if one is configured.
 *
 * Takes a GLB URL — a Ready Player Me avatar built from a selfie, or any
 * other model exporting ARKit-style blendshapes. Those give proper visemes
 * and eyelids, so the mouth forms shapes instead of a capsule opening and
 * shutting.
 *
 * Falls back to the procedural character whenever the model is absent, slow
 * or broken. A head that cannot load is worse than a simple head that always
 * does, and an avatar hosted somewhere else is a dependency this page does
 * not control.
 */

// ARKit names as Ready Player Me exports them. Every one is optional: models
// vary in what they rig, and a missing shape is skipped rather than assumed.
const VISEMES = ['viseme_aa', 'viseme_O', 'viseme_E', 'viseme_I', 'viseme_U'];
const JAW = ['jawOpen', 'mouthOpen'];
const BLINK = ['eyeBlinkLeft', 'eyeBlinkRight', 'eyesClosed'];
const SMILE = ['mouthSmileLeft', 'mouthSmileRight'];

const AvatarAnchor = ({
    url,
    speaking = false,
    listening = false,
    thinking = false,
    amplitude = 0,
    onFailed,
}) => {
    const mountRef = useRef(null);
    const state = useRef({ speaking, listening, thinking, amplitude });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        state.current = { speaking, listening, thinking, amplitude };
    }, [speaking, listening, thinking, amplitude]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !url) return undefined;

        let disposed = false;
        let frameId;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 1.9);
        key.position.set(1.5, 2.4, 2.5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x22d3ee, 1.2);
        rim.position.set(-2, 1, -1.5);
        scene.add(rim);

        // Morph targets are spread across several meshes (head, teeth, eyes),
        // so every mesh that has any is collected rather than assuming one.
        const morphs = [];
        const findMorph = (names) => {
            const hits = [];
            morphs.forEach(({ mesh, dictionary }) => {
                names.forEach((name) => {
                    const index = dictionary[name];
                    if (index !== undefined) hits.push({ mesh, index });
                });
            });
            return hits;
        };

        let head = null;
        let visemeTargets = [];
        let jawTargets = [];
        let blinkTargets = [];
        let smileTargets = [];

        const loader = new GLTFLoader();
        loader.load(
            url,
            (gltf) => {
                if (disposed) return;
                const model = gltf.scene;

                model.traverse((node) => {
                    if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
                        morphs.push({ mesh: node, dictionary: node.morphTargetDictionary });
                    }
                    // RPM names the neck joint "Head"; framing on it keeps the
                    // shot on the face regardless of the model's own height.
                    if (node.isBone && /head/i.test(node.name) && !head) head = node;
                });

                visemeTargets = findMorph(VISEMES);
                jawTargets = findMorph(JAW);
                blinkTargets = findMorph(BLINK);
                smileTargets = findMorph(SMILE);

                // Frame the head: avatars are exported life-size in metres and
                // standing on the origin, so a default camera sees the shins.
                const box = new THREE.Box3().setFromObject(model);
                const height = box.max.y - box.min.y || 1.7;
                model.position.y = -height * 0.62;
                camera.position.set(0, height * 0.28, height * 0.55);
                camera.lookAt(0, height * 0.28, 0);

                scene.add(model);
                setLoading(false);
            },
            undefined,
            (error) => {
                console.error('[avatar] could not load', error);
                if (!disposed) onFailed?.();
            },
        );

        const clock = new THREE.Clock();
        let blinkTimer = 2 + Math.random() * 3;
        let mouthOpen = 0;
        let visemeIndex = 0;
        let visemeTimer = 0;

        const setInfluence = (targets, value) => {
            targets.forEach(({ mesh, index }) => {
                mesh.morphTargetInfluences[index] = value;
            });
        };

        const resize = () => {
            const { clientWidth: w, clientHeight: h } = mount;
            if (!w || !h) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(mount);

        const animate = () => {
            frameId = requestAnimationFrame(animate);
            const dt = clock.getDelta();
            const t = clock.elapsedTime;
            const { speaking: talk, listening: hears, thinking: thinks, amplitude: amp } = state.current;

            if (head) {
                head.rotation.y = Math.sin(t * 0.5) * 0.12 + (thinks ? 0.18 : 0);
                head.rotation.x = Math.sin(t * 0.8) * 0.05 - (thinks ? 0.12 : 0);
                head.rotation.z = talk ? Math.sin(t * 2.3) * 0.04 : head.rotation.z * 0.9;
            }

            // Cycling visemes rather than holding one open shape: speech
            // synthesis gives no phonemes, but rotating through mouth shapes
            // in time with the envelope reads far closer to speech than a
            // single vowel held for a sentence.
            const target = talk ? 0.25 + amp * 0.75 : 0;
            mouthOpen += (target - mouthOpen) * Math.min(1, dt * 16);

            if (visemeTargets.length) {
                visemeTimer -= dt;
                if (visemeTimer <= 0 && talk) {
                    visemeIndex = (visemeIndex + 1) % Math.max(1, visemeTargets.length);
                    visemeTimer = 0.09 + Math.random() * 0.07;
                }
                visemeTargets.forEach((targetShape, i) => {
                    const active = talk && i === visemeIndex ? mouthOpen : 0;
                    const current = targetShape.mesh.morphTargetInfluences[targetShape.index];
                    targetShape.mesh.morphTargetInfluences[targetShape.index] =
                        current + (active - current) * Math.min(1, dt * 20);
                });
            }
            setInfluence(jawTargets, mouthOpen * 0.75);
            setInfluence(smileTargets, hears ? 0.28 : 0.1);

            blinkTimer -= dt;
            if (blinkTimer <= 0) {
                setInfluence(blinkTargets, 1);
                if (blinkTimer < -0.1) {
                    setInfluence(blinkTargets, 0);
                    blinkTimer = 2.5 + Math.random() * 3.5;
                }
            }

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            disposed = true;
            cancelAnimationFrame(frameId);
            observer.disconnect();
            renderer.dispose();
            scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    const list = Array.isArray(object.material) ? object.material : [object.material];
                    list.forEach((m) => {
                        Object.values(m).forEach((v) => v?.isTexture && v.dispose());
                        m.dispose();
                    });
                }
            });
            if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        };
    }, [url, onFailed]);

    return (
        <div ref={mountRef} className="w-full h-full relative" role="img" aria-label="News assistant">
            {loading && (
                <div className="absolute inset-0 grid place-items-center">
                    <div className="w-24 h-24 rounded-full bg-white/[0.04] animate-pulse" />
                </div>
            )}
        </div>
    );
};

export default AvatarAnchor;
