import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VISEMES, JAW, BLINK, SMILE, resolveMorphTargets } from '../lib/morphTargets';

/**
 * A real avatar, if one is configured.
 *
 * Takes any GLB URL. Models exporting ARKit or Oculus blendshapes get proper
 * visemes and eyelids, so the mouth forms shapes instead of a capsule opening
 * and shutting; models without them still animate, just more simply.
 *
 * Source-agnostic on purpose. This was written against Ready Player Me, which
 * shut down weeks later and took every avatar hosted on it — so the loader
 * knows nothing about where a model comes from, and self-hosting the file is
 * the documented default.
 *
 * Falls back to the procedural character whenever the model is absent, slow
 * or broken. A head that cannot load is worse than a simple head that always
 * does, and an avatar hosted somewhere else is a dependency this page does
 * not control.
 */

// A model that sends no bytes for this long is treated as dead rather than
// left spinning; the fallback character is better than an empty box.
const STALL_MS = 15000;
// Progress can continue forever on a hostile connection. Past this, the wait
// costs more than the nicer head is worth.
const HARD_LIMIT_MS = 60000;

// Beyond roughly this, the avatar is a bigger download than the entire rest
// of the page. Worth saying out loud rather than silently shipping it.
const SIZE_WARN_BYTES = 8 * 1024 * 1024;

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
    const [percent, setPercent] = useState(0);

    // Held in a ref rather than read from the closure. Callers pass this
    // inline, so it is a new function on every render, and naming it as a
    // dependency of the loading effect below tore down the scene and
    // re-downloaded the model every time the parent re-rendered — which,
    // while speaking, is once per animation frame.
    const onFailedRef = useRef(onFailed);
    useEffect(() => { onFailedRef.current = onFailed; }, [onFailed]);

    useEffect(() => {
        state.current = { speaking, listening, thinking, amplitude };
    }, [speaking, listening, thinking, amplitude]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount || !url) return undefined;

        let disposed = false;
        let frameId;
        let settled = false;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.style.display = 'block';
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

        const findMorph = (names) => resolveMorphTargets(morphs, names);

        let head = null;
        let visemeTargets = [];
        let jawTargets = [];
        let blinkTargets = [];
        let smileTargets = [];

        const giveUp = (reason, detail) => {
            if (settled || disposed) return;
            settled = true;
            console.error(`[avatar] ${reason}`, detail ?? '');
            onFailedRef.current?.();
        };

        // Compressed geometry and textures are routine in avatar exports, and
        // without these three the load fails with an error naming a decoder
        // rather than anything the reader can act on. Decoders are fetched
        // only when a file actually uses them.
        const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
        const ktx2 = new KTX2Loader()
            .setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
            .detectSupport(renderer);

        const loader = new GLTFLoader()
            .setDRACOLoader(draco)
            .setKTX2Loader(ktx2)
            .setMeshoptDecoder(MeshoptDecoder);

        let lastProgress = Date.now();
        const startedAt = lastProgress;
        const watchdog = setInterval(() => {
            if (settled || disposed) return;
            const now = Date.now();
            if (now - lastProgress > STALL_MS) {
                giveUp('download stalled; falling back to the built-in character');
            } else if (now - startedAt > HARD_LIMIT_MS) {
                giveUp('model too slow to be worth waiting for; using the built-in character');
            }
        }, 2000);

        loader.load(
            url,
            (gltf) => {
                if (disposed) return;
                settled = true;
                const model = gltf.scene;

                model.traverse((node) => {
                    if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
                        morphs.push({ mesh: node, dictionary: node.morphTargetDictionary });
                    }
                    // Most rigs name the neck joint "Head"; framing on it keeps
                    // the shot on the face whatever the model's own height.
                    if (node.isBone && /head/i.test(node.name) && !head) head = node;
                });

                visemeTargets = findMorph(VISEMES);
                jawTargets = findMorph(JAW);
                blinkTargets = findMorph(BLINK);
                smileTargets = findMorph(SMILE);

                if (!visemeTargets.length && !jawTargets.length) {
                    console.warn(
                        '[avatar] model has no viseme or jaw blendshapes, so the mouth cannot move. '
                        + 'Re-export it with ARKit or Oculus blendshapes enabled.',
                    );
                }

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
            (event) => {
                lastProgress = Date.now();
                if (event.total > 0) {
                    setPercent(Math.min(99, Math.round((event.loaded / event.total) * 100)));
                    if (event.total > SIZE_WARN_BYTES) {
                        console.warn(
                            `[avatar] model is ${(event.total / 1024 / 1024).toFixed(1)} MB. `
                            + 'Consider exporting a head-only or lower-resolution version.',
                        );
                    }
                }
            },
            (error) => {
                // The browser reports a blocked cross-origin fetch and a 404
                // identically, so name both rather than guess.
                giveUp(
                    'could not load the model. Check the URL is reachable and that its host '
                    + 'sends CORS headers — serving the .glb from this site avoids both problems.',
                    error,
                );
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
            // updateStyle left on: nothing else gives the canvas a CSS size, so
            // without it the element displays at devicePixelRatio times the
            // frame and overflows onto the controls below.
            renderer.setSize(w, h);
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
            clearInterval(watchdog);
            cancelAnimationFrame(frameId);
            observer.disconnect();
            draco.dispose();
            ktx2.dispose();
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
        // `url` only. The model is expensive to fetch and build, so this must
        // run when the model changes and at no other time.
    }, [url]);

    return (
        <div ref={mountRef} className="w-full h-full relative" role="img" aria-label="News assistant">
            {loading && (
                <div className="absolute inset-0 grid place-items-center">
                    <div className="w-24 h-24 rounded-full bg-white/[0.04] animate-pulse" />
                    {percent > 0 && (
                        <span className="absolute bottom-6 text-[11px] tabular-nums text-slate-500">
                            {percent}%
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

export default AvatarAnchor;
