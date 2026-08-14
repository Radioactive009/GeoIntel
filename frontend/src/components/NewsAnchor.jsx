import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * The assistant, as a character.
 *
 * Built from primitives rather than loaded as a rigged model. A GLB with real
 * blendshapes would animate better, but it means shipping several megabytes of
 * asset and depending on a host to serve it — for a head that nods and moves
 * its mouth, geometry generated at runtime costs nothing to download and
 * cannot 404. That last point stopped being hypothetical when the avatar
 * service this was originally paired with shut down.
 *
 * Shaped for a small frame. It renders at a couple of hundred pixels, where
 * silhouette and proportion carry everything and fine modelling is invisible,
 * so the effort goes into the head-to-shoulder ratio, a real neck, and a
 * jacket-and-tie outline that reads as a presenter at a glance.
 *
 * Lip movement is driven by the caller through `speaking` and `amplitude`
 * rather than by analysing audio here, because the browser's speech synthesis
 * gives no audio stream to analyse. Word-boundary events drive a rough
 * envelope instead, which reads as speech without pretending to be phonetic.
 */

const SKIN = 0xe0a882;
const SKIN_SHADE = 0xcf946f;
const HAIR = 0x241a14;
const JACKET = 0x1b2637;
const SHIRT = 0xf1f5f9;
const TIE = 0x0e7490;

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
        // Framed as a bust: the top of the hair to the upper chest, which is
        // how a presenter is actually shot, and the only framing that still
        // reads once this is a couple of hundred pixels wide.
        const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
        camera.position.set(0, 0.15, 6.6);
        camera.lookAt(0, 0.15, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        mount.appendChild(renderer.domElement);

        // ── Lighting: key, warm fill to keep the shadow side from going dead,
        //    cool rim to separate the silhouette from a dark page ──
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const key = new THREE.DirectionalLight(0xfff4e8, 1.45);
        key.position.set(2.2, 2.6, 4);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xbcd4ff, 0.45);
        fill.position.set(-2.6, 0.4, 2.2);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0x22d3ee, 1.25);
        rim.position.set(-2.4, 1.8, -2.6);
        scene.add(rim);

        // Skin at full roughness looks like clay and at low roughness like
        // plastic; this sits between, with a trace of sheen.
        const skin = (color = SKIN) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 });
        const cloth = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.0 });

        const person = new THREE.Group();
        scene.add(person);

        // ── Head ──
        const head = new THREE.Group();
        head.position.y = 0.95;
        person.add(head);

        // Taller than wide and deeper than wide, which is a head; a plain
        // sphere is a ball and no amount of detail on top fixes that.
        const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 56), skin());
        skull.scale.set(0.95, 1.13, 1.02);
        head.add(skull);

        // Overlapping mass at the bottom front, giving a jaw and chin instead
        // of a spherical underside.
        const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 40), skin());
        jaw.scale.set(0.92, 0.78, 1.0);
        jaw.position.set(0, -0.44, 0.05);
        head.add(jaw);

        // ── Hair: a cap and a swept fringe. Rounded rather than boxy, because
        //    a hard edge at this size reads as a hat ──
        const hairCap = new THREE.Mesh(
            new THREE.SphereGeometry(1.045, 44, 44, 0, Math.PI * 2, 0, Math.PI * 0.58),
            cloth(HAIR),
        );
        hairCap.scale.set(0.96, 1.16, 1.03);
        hairCap.position.y = 0.02;
        head.add(hairCap);

        const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 32), cloth(HAIR));
        fringe.scale.set(1.45, 0.44, 0.62);
        fringe.position.set(-0.08, 0.63, 0.6);
        fringe.rotation.z = -0.16;
        head.add(fringe);

        [-1, 1].forEach((side) => {
            const sideburn = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 20), cloth(HAIR));
            sideburn.scale.set(0.5, 1.5, 0.9);
            sideburn.position.set(side * 0.88, 0.16, 0.05);
            head.add(sideburn);
        });

        [-1, 1].forEach((side) => {
            const ear = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 20), skin(SKIN_SHADE));
            ear.position.set(side * 0.92, -0.08, 0.02);
            ear.scale.set(0.55, 1.05, 0.7);
            head.add(ear);
        });

        // ── Eyes: set into the face rather than sitting on it ──
        const eyes = [-1, 1].map((side) => {
            const group = new THREE.Group();
            group.position.set(side * 0.33, 0.08, 0.76);

            const white = new THREE.Mesh(
                new THREE.SphereGeometry(0.165, 24, 24),
                new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 }),
            );
            white.scale.set(1, 0.92, 0.8);
            group.add(white);

            const pupil = new THREE.Mesh(
                new THREE.SphereGeometry(0.082, 20, 20),
                new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.2 }),
            );
            pupil.position.z = 0.11;
            group.add(pupil);

            const brow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 20), cloth(HAIR));
            brow.scale.set(1.1, 0.3, 0.4);
            brow.position.set(0, 0.32, 0.06);
            brow.rotation.z = side * 0.1;
            group.add(brow);

            head.add(group);
            return { group, pupil, brow };
        });

        // ── Glasses: proportionate. Oversized frames turn a presenter into a
        //    caricature, and the silhouette is doing that work already ──
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.45 });
        [-1, 1].forEach((side) => {
            const lens = new THREE.Mesh(new THREE.TorusGeometry(0.265, 0.03, 12, 32), frameMat);
            lens.position.set(side * 0.33, 0.08, 0.83);
            head.add(lens);

            const glass = new THREE.Mesh(
                new THREE.CircleGeometry(0.25, 28),
                new THREE.MeshStandardMaterial({
                    color: 0xbfe6ff, transparent: true, opacity: 0.11, roughness: 0.08,
                }),
            );
            glass.position.set(side * 0.33, 0.08, 0.83);
            head.add(glass);

            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.028, 0.028), frameMat);
            arm.position.set(side * 0.68, 0.1, 0.56);
            arm.rotation.y = side * 0.72;
            head.add(arm);
        });
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.028, 0.028), frameMat);
        bridge.position.set(0, 0.1, 0.86);
        head.add(bridge);

        // A rounded wedge rather than a cone: a cone points, and a pointing
        // nose is the fastest way to make a face look like a puppet.
        const nose = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 24), skin(SKIN_SHADE));
        nose.scale.set(0.72, 1.05, 1.15);
        nose.position.set(0, -0.16, 0.88);
        head.add(nose);

        // ── Mouth: scaled while speaking, which is the whole lip-sync ──
        const mouth = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.1, 0.26, 6, 16),
            new THREE.MeshStandardMaterial({ color: 0x8c3a44, roughness: 0.5 }),
        );
        mouth.position.set(0, -0.58, 0.79);
        mouth.rotation.z = Math.PI / 2;
        mouth.scale.set(1, 1, 0.45);
        head.add(mouth);

        // ── Neck: the head floated without one, which was most of why the
        //    proportions read as a bobblehead. It overlaps into both the skull
        //    above and the jacket below rather than meeting them, so no seam
        //    opens up when the head turns ──
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.40, 0.7, 28), skin(SKIN_SHADE));
        neck.position.y = -0.30;
        person.add(neck);

        // ── Shoulders. Wider than the head — the old torso was narrower, which
        //    is the other half of why this read as a bobblehead — and flattened
        //    front-to-back, because a round cylinder reads as a barrel.
        //
        //    Deliberately longer than the frame. A torso ending inside the shot
        //    shows its own bottom rim and becomes a bust on a shelf; running it
        //    past the edge is what makes this look framed rather than floating ──
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.14, 1.46, 2.7, 36), cloth(JACKET));
        torso.position.y = -1.70;
        torso.scale.z = 0.52;
        person.add(torso);

        [-1, 1].forEach((side) => {
            const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 28, 28), cloth(JACKET));
            cap.position.set(side * 1.06, -0.45, 0);
            cap.scale.set(1, 0.8, 0.52);
            person.add(cap);
        });

        // Shirt, collar and tie. Depth here is not decorative: the jacket is a
        // tapered cylinder, so its front surface moves forward as it widens,
        // and anything laid on the chest at a fixed depth gets swallowed
        // further down. Each layer clears the one behind it at every height
        // that is actually on screen.
        const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.52, 2.4, 24), cloth(SHIRT));
        shirt.position.set(0, -1.50, 0.66);
        shirt.scale.z = 0.40;
        person.add(shirt);

        [-1, 1].forEach((side) => {
            const collar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.10), cloth(SHIRT));
            collar.position.set(side * 0.24, -0.42, 0.74);
            collar.rotation.z = side * 0.34;
            person.add(collar);
        });

        const knot = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.22, 0.14), cloth(TIE));
        knot.position.set(0, -0.55, 0.86);
        person.add(knot);

        // Cone apex upward: a tie is narrow at the knot and wide at the tip,
        // and four radial segments give it a flat face rather than a dowel.
        const tie = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1.4, 4), cloth(TIE));
        tie.position.set(0, -1.35, 0.88);
        tie.rotation.y = Math.PI / 4;
        person.add(tie);

        // A floating "on air" ring, which also gives the listening state
        // something to do that is visible at a glance.
        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(1.62, 0.02, 10, 64),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0 }),
        );
        halo.rotation.x = Math.PI / 2.1;
        halo.position.y = -1.8;
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
            person.rotation.y = Math.sin(t * 0.5) * 0.07;
            person.position.y = Math.sin(t * 1.1) * 0.02;
            head.rotation.x = Math.sin(t * 0.8) * 0.035;

            if (talk) {
                // Envelope from the caller, plus jitter so it does not pulse
                // mechanically between syllables.
                const target = 0.25 + amp * 0.9 + Math.abs(Math.sin(t * 19)) * 0.25;
                mouthOpen += (target - mouthOpen) * Math.min(1, dt * 18);
                head.rotation.z = Math.sin(t * 2.4) * 0.03;
                head.rotation.y = Math.sin(t * 1.7) * 0.05;
            } else {
                mouthOpen += (0 - mouthOpen) * Math.min(1, dt * 10);
                head.rotation.z *= 0.9;
                head.rotation.y *= 0.9;
            }
            mouth.scale.z = 0.45 + mouthOpen * 2.3;
            mouth.scale.x = 1 - mouthOpen * 0.18;

            if (thinks) {
                // Looks up and to the side, the universal shorthand.
                head.rotation.x = -0.15 + Math.sin(t * 1.6) * 0.045;
                eyes.forEach((eye) => {
                    eye.pupil.position.x = Math.sin(t * 1.3) * 0.045;
                    eye.brow.position.y = 0.36;
                });
            } else {
                eyes.forEach((eye) => {
                    eye.pupil.position.x *= 0.9;
                    eye.brow.position.y += (0.32 - eye.brow.position.y) * 0.2;
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

            halo.material.opacity += ((hears ? 0.7 : 0) - halo.material.opacity) * 0.12;
            halo.scale.setScalar(hears ? 1 + Math.sin(t * 4) * 0.045 + amp * 0.22 : 1);

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
