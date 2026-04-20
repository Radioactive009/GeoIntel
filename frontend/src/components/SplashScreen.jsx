import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useAnimationFrame, useMotionValue, useTransform, animate } from 'framer-motion';
import Logo from './Logo';

// Optimized 1K Textures
const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_1024.jpg";
const CLOUD_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png";

// ── Technical Grid Background ─────────────────────────────
const CyberGrid = () => (
    <div className="absolute inset-0 pointer-events-none z-0">
        <div 
            className="absolute inset-0 opacity-[0.04]"
            style={{
                backgroundImage: `linear-gradient(to right, #22d3ee 1px, transparent 1px), linear-gradient(to bottom, #22d3ee 1px, transparent 1px)`,
                backgroundSize: '40px 40px',
                maskImage: 'radial-gradient(circle at center, black, transparent 80%)'
            }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#22d3ee05] to-transparent animate-pulse" />
    </div>
);

// ── Shockwave Effect ──────────────────────────────────────
const Shockwave = () => (
    <motion.div
        className="absolute rounded-full border-[1px] border-cyan-300/40 z-20 will-change-transform"
        style={{ transform: 'translateZ(0)' }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ 
            scale: 20, 
            opacity: [0, 1, 0],
            borderWidth: ['1px', '4px', '1px']
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
    />
);

// ── Starfield Component ───────────────────────────────────
const Starfield = () => {
    const stars = useMemo(() => {
        return Array.from({ length: 150 }).map((_, i) => ({
            id: i,
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            size: Math.random() * 2 + 1,
            duration: Math.random() * 5 + 3,
            delay: Math.random() * 2
        }));
    }, []);

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
            {stars.map(star => (
                <motion.div
                    key={star.id}
                    className="absolute bg-white rounded-full opacity-20"
                    style={{
                        top: star.top,
                        left: star.left,
                        width: star.size,
                        height: star.size,
                    }}
                    animate={{ opacity: [0.1, 0.4, 0.1], scale: [1, 1.2, 1] }}
                    transition={{
                        duration: star.duration,
                        repeat: Infinity,
                        delay: star.delay,
                        ease: "linear"
                    }}
                />
            ))}
        </div>
    );
};

const UltraRealGlobe = ({ speedValue, isBursting }) => {
    const surfacePos = useMotionValue(0);
    const cloudPos = useMotionValue(0);
    
    const xSurface = useTransform(surfacePos, (v) => `${v}%`);
    const xCloud = useTransform(cloudPos, (v) => `${v}%`);

    useAnimationFrame((time, delta) => {
        if (isBursting) return;
        const currentSpeed = speedValue.get();
        if (currentSpeed === 0) return;

        const sMove = (delta * 0.005) * currentSpeed;
        const cMove = (delta * 0.006) * currentSpeed;

        // Smoother modulo logic for infinite scroll
        surfacePos.set((surfacePos.get() - sMove) % 50);
        cloudPos.set((cloudPos.get() - cMove) % 50);
    });

    return (
        <div className="relative flex items-center justify-center scale-110 will-change-transform">
            <div className={`absolute inset-0 rounded-full bg-blue-600/10 blur-[100px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden border border-white/10 shadow-2xl bg-black transform-gpu">
                <motion.div style={{ x: xSurface }} className="absolute inset-y-0 left-0 flex brightness-110 contrast-125 saturate-125">
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                </motion.div>
                <motion.div style={{ x: xCloud }} className="absolute inset-y-0 left-0 flex opacity-40 mix-blend-screen scale-[1.02]">
                    <img src={CLOUD_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                    <img src={CLOUD_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                </motion.div>
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.08)_0%,rgba(0,0,0,0)_45%,rgba(0,0,0,0.7)_75%,rgba(0,0,0,1)_100%)]" />
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_0_60px_rgba(34,211,238,0.3),inset_0_0_120px_rgba(59,130,246,0.1)] opacity-70" />
            </div>

            <div className={`absolute -inset-2 rounded-full border-[2px] border-blue-400/20 blur-[2px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const speedValue = useMotionValue(0);

    useEffect(() => {
        const sequence = async () => {
            // GLOBE PHASE: 3.0 Seconds Total
            // ── 1. Linear Acceleration (2500ms)
            // Using .then() to ensure precise timing sync
            await animate(speedValue, 20, {
                duration: 2.5,
                ease: "linear"
            });
            
            // ── 2. The Great Burst (1500ms)
            setPhase('burst');
            await new Promise(r => setTimeout(r, 1500));
            
            // LOGO PHASE: 2.0 Seconds Total
            // ── 3. Logo Reveal & Stay (1250ms)
            setPhase('logo');
            await new Promise(r => setTimeout(r, 1250));
            
            // ── 4. Glide to Navbar & Dissolve (750ms)
            setPhase('moving');
            await new Promise(r => setTimeout(r, 750));
            
            onComplete();
        };
        sequence();
    }, [onComplete, speedValue]);

    return (
        <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00040d] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
        >
            <Starfield />

            {(phase === 'logo' || phase === 'moving') && <CyberGrid />}

            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <filter id="bloom">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </svg>

            <AnimatePresence>
                {(phase === 'spinning' || phase === 'burst') && (
                    <motion.div
                        key="globe-scene"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 12 : 1,
                            opacity: phase === 'burst' ? 0.8 : 1, // Keep visible longer
                            filter: phase === 'burst' 
                                ? 'brightness(15) blur(10px)' 
                                : 'brightness(1) blur(0px)'
                        }}
                        exit={{ opacity: 0, scale: 15 }} // Slower exit animation
                        transition={{ 
                            duration: phase === 'burst' ? 1.5 : 1.2,
                            ease: phase === 'burst' ? [0.16, 1, 0.3, 1] : "easeOut"
                        }}
                        className="relative z-10 flex items-center justify-center transform-gpu"
                        style={{ filter: 'url(#bloom)' }}
                    >
                        {phase === 'burst' && <Shockwave />}
                        <UltraRealGlobe speedValue={speedValue} isBursting={phase === 'burst'} />
                    </motion.div>
                )}

                {(phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="site-intro"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8 }}
                        className="absolute inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
                    >
                        <motion.div 
                            className="absolute top-0 w-full h-1 bg-cyan-400/40 blur-sm shadow-[0_0_20px_rgba(34,211,238,0.6)]"
                            initial={{ top: '0%' }}
                            animate={{ top: '100%' }}
                            transition={{ duration: 1.2, repeat: 1, ease: "linear" }}
                        />

                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 1.1, opacity: 0, filter: 'blur(15px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ 
                                type: "spring", stiffness: 40, damping: 15, mass: 1.4
                            }}
                            className="flex flex-col items-center gap-8 relative"
                        >
                            <Logo className="scale-[2.6]" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-cyan-200/40 z-[10000] mix-blend-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, times: [0, 0.1, 0.6, 1] }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
