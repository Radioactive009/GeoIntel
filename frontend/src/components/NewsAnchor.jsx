import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The assistant, as a character.
 *
 * Built from primitives rather than loaded as a rigged model. A GLB with real
 * blendshapes would animate better, but it means shipping several megabytes of
 * asset and depending on a host to serve it — for a head that nods and moves
 * its mouth, geometry generated at runtime costs nothing to download and
 * cannot 404.
 *
 * Lip movement is driven by the caller through `speaking` and `amplitude`
 * rather than by analysing audio here, because the browser's speech synthesis
 * gives no audio stream to analyse. Word-boundary events drive a rough
 * envelope instead, which reads as speech without pretending to be phonetic.
 */

const SKIN = 0xe8b18c;
const HAIR = 0x2b1d16;
const SHIRT = 0x1e293b;
const TIE = 0x06b6d4;

const NewsAnchor = ({ speaking = false, listening = false, thinking = false, amplitude = 0 }) => {
    const mountRef = useRef(null);
    // Animation reads these every frame; props would be stale inside the loop.
    const state = useRef({ speaking, listening, thinking, amplitude });

    useEffect(() => {
        state.current = { speaking, listening, thinking, amplitude };
    }, [speaking, listening, thinking, amplitude]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return undefined;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        camera.position.set(0, 0.35, 5.4);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        mount.appendChild(renderer.domElement);

        // ── Lighting: soft key, cool rim to match the site's cyan accent ──
        scene.add(new THREE.AmbientLight(0xffffff, 0.75));
        const key = new THREE.DirectionalLight(0xffffff, 1.5);
        key.position.set(2.5, 3, 4);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0x22d3ee, 1.1);
        rim.position.set(-3, 1.5, -2);
        scene.add(rim);

        const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });

        const person = new THREE.Group();
        scene.add(person);

        // ── Head ──
        const head = new THREE.Group();
        head.position.y = 0.75;
        person.add(head);

        const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), matte(SKIN));
        skull.scale.set(1, 1.12, 0.95);
        head.add(skull);

        // Hair: a cap plus a fringe, which is what makes the silhouette read
        // as a person rather than a ball.
        const hairCap = new THREE.Mesh(
            new THREE.SphereGeometry(1.03, 40, 40, 0, Math.PI * 2, 0, Math.PI * 0.55),
            matte(HAIR),
        );
        hairCap.scale.set(1, 1.12, 0.97);
        hairCap.position.y = 0.06;
        head.add(hairCap);

        const fringe = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.35), matte(HAIR));
        fringe.position.set(-0.15, 0.62, 0.82);
        fringe.rotation.z = -0.22;
        head.add(fringe);

        const ears = [-1, 1].map((side) => {
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 20), matte(SKIN));
            ear.position.set(side * 0.96, -0.05, 0);
            ear.scale.set(0.6, 1, 0.7);
            head.add(ear);
            return ear;
        });

        // ── Eyes ──
        const eyes = [-1, 1].map((side) => {
            const group = new THREE.Group();
            group.position.set(side * 0.34, 0.12, 0.84);

            const white = new THREE.Mesh(
                new THREE.SphereGeometry(0.19, 24, 24),
                new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
            );
            group.add(white);

            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(0.093, 20, 20),
                new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.25 }),
            );
            pupil.position.z = 0.13;
            group.add(pupil);

            const brow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.075, 0.09), matte(HAIR));
            brow.position.set(0, 0.34, 0.06);
            group.add(brow);

            head.add(group);
            return { group, pupil, brow };
        });

        // ── Glasses: the nerd signifier, so they are deliberately oversized ──
        const frame = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.3 });
        [-1, 1].forEach((side) => {
            const lens = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 14, 34), frame);
            lens.position.set(side * 0.34, 0.12, 0.9);
            head.add(lens);

            const glass = new THREE.Mesh(
                new THREE.CircleGeometry(0.28, 30),
                new THREE.MeshStandardMaterial({
                    color: 0x9fd8ff, transparent: true, opacity: 0.16, roughness: 0.1,
                }),
            );
            glass.position.set(side * 0.34, 0.12, 0.9);
            head.add(glass);

            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), frame);
            arm.position.set(side * 0.72, 0.14, 0.62);
            arm.rotation.y = side * 0.7;
            head.add(arm);
        });
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.04), frame);
        bridge.position.set(0, 0.14, 0.92);
        head.add(bridge);

        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 14), matte(0xdfa47e));
        nose.position.set(0, -0.12, 0.94);
        nose.rotation.x = Math.PI / 2;
        head.add(nose);

        // ── Mouth: scaled on Y while speaking, which is the whole lip-sync ──
        const mouth = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.13, 0.3, 6, 16),
            new THREE.MeshStandardMaterial({ color: 0x7f2b3a, roughness: 0.6 }),
        );
        mouth.position.set(0, -0.46, 0.84);
        mouth.rotation.z = Math.PI / 2;
        mouth.scale.set(1, 1, 0.5);
        head.add(mouth);

        // ── Body ──
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.95, 1.5, 28), matte(SHIRT));
        torso.position.y = -0.95;
        person.add(torso);

        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 12, 26), matte(0xf8fafc));
        collar.position.y = -0.32;
        collar.rotation.x = Math.PI / 2;
        person.add(collar);

        const tie = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.85, 4), matte(TIE));
        tie.position.set(0, -0.85, 0.55);
        tie.rotation.x = -0.12;
        person.add(tie);

        // A floating "on air" ring, which also gives the listening state
        // something to do that is visible from across the room.
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(1.5, 0.022, 10, 64),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0 }),
        );
        halo.rotation.x = Math.PI / 2.1;
        halo.position.y = -1.35;
        scene.add(halo);

        // ── Animation ──
        let frameId;
        let blinkTimer = 2 + Math.random() * 3;
        let mouthOpen = 0;
        const clock = new THREE.Clock();

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

            // Idle: never perfectly still, or it reads as a frozen render.
            person.rotation.y = Math.sin(t * 0.5) * 0.09;
            person.position.y = Math.sin(t * 1.1) * 0.025;
            head.rotation.x = Math.sin(t * 0.8) * 0.04;

            if (talk) {
                // Envelope from the caller, plus jitter so it does not pulse
                // mechanically between syllables.
                const target = 0.25 + amp * 0.9 + Math.abs(Math.sin(t * 19)) * 0.25;
                mouthOpen += (target - mouthOpen) * Math.min(1, dt * 18);
                head.rotation.z = Math.sin(t * 2.4) * 0.035;
                head.rotation.y = Math.sin(t * 1.7) * 0.06;
            } else {
                mouthOpen += (0 - mouthOpen) * Math.min(1, dt * 10);
                head.rotation.z *= 0.9;
                head.rotation.y *= 0.9;
            }
            mouth.scale.z = 0.5 + mouthOpen * 2.4;
            mouth.scale.x = 1 - mouthOpen * 0.18;

            if (thinks) {
                // Looks up and to the side, the universal shorthand.
                head.rotation.x = -0.16 + Math.sin(t * 1.6) * 0.05;
                eyes.forEach((eye) => { eye.pupil.position.x = Math.sin(t * 1.3) * 0.05; });
                eyes.forEach((eye) => { eye.brow.position.y = 0.38; });
            } else {
                eyes.forEach((eye) => {
                    eye.pupil.position.x *= 0.9;
                    eye.brow.position.y += (0.34 - eye.brow.position.y) * 0.2;
                });
            }

            // Blink: a fast squash, at human-ish intervals.
            blinkTimer -= dt;
            if (blinkTimer <= 0) {
                eyes.forEach((eye) => { eye.group.scale.y = 0.12; });
                if (blinkTimer < -0.09) {
                    eyes.forEach((eye) => { eye.group.scale.y = 1; });
                    blinkTimer = 2.5 + Math.random() * 3.5;
                }
            }

            halo.material.opacity += ((hears ? 0.75 : 0) - halo.material.opacity) * 0.12;
            halo.scale.setScalar(hears ? 1 + Math.sin(t * 4) * 0.05 + amp * 0.25 : 1);

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(frameId);
            observer.disconnect();
            renderer.dispose();
            scene.traverse((object) => {
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    const materials = Array.isArray(object.material) ? object.material : [object.material];
                    materials.forEach((m) => m.dispose());
                }
            });
            if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
        };
    }, []);

    return (
        <div
            ref={mountRef}
            className="w-full h-full"
            role="img"
            aria-label="Animated news assistant"
        />
    );
};

export default NewsAnchor;
