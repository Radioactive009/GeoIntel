import React, { useEffect, useState, useMemo } from 'react';
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

// ── Volumetric Shockwaves (Atmospheric Ripples) ──────────
const Shockwaves = () => {
    const ripples = [
        { scale: 12, duration: 2.2, color: 'bg-cyan-400/20', blur: '30px' },
        { scale: 18, duration: 1.8, color: 'bg-blue-500/10', blur: '60px' },
        { scale: 15, duration: 1.4, color: 'bg-white/30', blur: '20px' }
    ];

    return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {ripples.map((rip, i) => (
                <motion.div
                    key={i}
                    className={`absolute rounded-full ${rip.color} z-20 will-change-transform`}
                    style={{ filter: `blur(${rip.blur})` }}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ 
                        scale: rip.scale, 
                        opacity: [0, 0.6, 0],
                    }}
                    transition={{ 
                        duration: rip.duration, 
                        ease: "easeOut" 
                    }}
                />
            ))}
        </div>
    );
};

// ── Optical Lens Flare ──────────────────────────────────
const LensFlare = () => (
    <div className="absolute inset-0 pointer-events-none z-[10000] flex items-center justify-center">
        {/* Central Sun Flare */}
        <motion.div 
            className="absolute w-64 h-64 bg-white rounded-full blur-[40px] opacity-0"
            animate={{ 
                scale: [0, 10], 
                opacity: [0, 0.8, 0],
            }}
            transition={{ duration: 1.5, ease: "easeOut" }}
        />
        


        {/* Lens Ghosts */}
        {[0.4, 0.7, -0.3, -0.6].map((offset, i) => (
            <motion.div
                key={i}
                className="absolute w-12 h-12 rounded-full border border-white/20 bg-white/5 blur-[2px]"
                animate={{ 
                    x: [0, 500 * offset],
                    y: [0, 200 * offset],
                    opacity: [0, 0.4, 0],
                    scale: [0, 1.5 + i * 0.5]
                }}
                transition={{ duration: 2, ease: "easeOut" }}
            />
        ))}
    </div>
);

// ── Warp Speed Starfield ────────────────────────────────
const Starfield = () => {
    const stars = useMemo(() => {
        return Array.from({ length: 180 }).map((_, i) => ({
            id: i,
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            size: Math.random() * 2 + 1,
            duration: Math.random() * 4 + 2,
            delay: Math.random() * 2
        }));
    }, []);

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 bg-[#00040d]">
            {stars.map(star => (
                <motion.div
                    key={star.id}
                    className="absolute bg-white rounded-full opacity-[0.15]"
                    style={{
                        top: star.top,
                        left: star.left,
                        width: star.size,
                        height: star.size,
                        transformZ: 0
                    }}
                    animate={{ opacity: [0.1, 0.3, 0.1], scale: [1, 1.1, 1] }}
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


// ── Energy Vortex (Spiral) ───────────────────────────────
const EnergyVortex = () => (
    <motion.div 
        className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none will-change-transform"
        initial={{ rotate: 0, scale: 0.5, opacity: 0 }}
        animate={{ rotate: 720, scale: 6, opacity: [0, 1, 0] }}
        transition={{ duration: 3, ease: "easeOut" }}
    >
        <svg width="600" height="600" viewBox="0 0 600 600" className="opacity-30 mix-blend-screen overflow-visible">
            {[...Array(5)].map((_, i) => (
                <motion.path
                    key={i}
                    d="M300,300 C300,100 500,100 500,300 C500,500 100,500 100,300"
                    fill="none"
                    stroke={i % 2 === 0 ? "#22d3ee" : "#6366f1"}
                    strokeWidth="1.5"
                    strokeDasharray="20 30"
                    style={{ rotate: i * 72 }}
                    animate={{ strokeDashoffset: [0, -100] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                />
            ))}
        </svg>
    </motion.div>
);

// ── Glitch Displacement Overlay ─────────────────────────
const GlitchOverlay = () => (
    <motion.div
        className="absolute inset-0 z-[10000] border-[20px] border-cyan-500/10 pointer-events-none"
        animate={{ 
            x: [0, -15, 10, -5, 15, 0],
            skewX: [0, 5, -5, 2, -2, 0],
            filter: [
                'hue-rotate(0deg) contrast(1)',
                'hue-rotate(90deg) contrast(1.5)',
                'hue-rotate(-90deg) contrast(1.2)',
                'hue-rotate(0deg) contrast(1)'
            ]
        }}
        transition={{ duration: 0.3, repeat: 2 }}
    />
);

const UltraRealGlobe = ({ speedValue, isBursting }) => {
    const surfacePos = useMotionValue(0);
    const cloudPos = useMotionValue(0);
    
    const xSurface = useTransform(surfacePos, (v) => `${v}%`);
    const xCloud = useTransform(cloudPos, (v) => `${v}%`);

    useAnimationFrame((time, delta) => {
        if (isBursting) return;
        const currentSpeed = speedValue.get();
        if (currentSpeed === 0) return;

        // Move positions based on speed and delta time
        const sMove = (delta * 0.005) * currentSpeed;
        const cMove = (delta * 0.006) * currentSpeed;

        // Infinite scroll logic (texture is 2x width, so 0 to -50%)
        surfacePos.set((surfacePos.get() - sMove) % 50);
        cloudPos.set((cloudPos.get() - cMove) % 50);
    });

    return (
        <div className="relative flex items-center justify-center scale-110 will-change-transform">
            {!isBursting && <div className="absolute inset-0 rounded-full bg-blue-600/10 blur-[100px] animate-pulse" />}
            
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
        </div>
    );
};


const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const speedValue = useMotionValue(1);

    useEffect(() => {
        const sequence = async () => {
            // Linear Acceleration
            await animate(speedValue, 20, { duration: 2.5, ease: "linear" });
            
            setPhase('burst');
            await new Promise(r => setTimeout(r, 1800));
            
            setPhase('logo');

            await new Promise(r => setTimeout(r, 1250));
            
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
            {phase === 'burst' && <GlitchOverlay />}

            <AnimatePresence>
                {(phase === 'spinning' || phase === 'burst') && (
                    <motion.div
                        key="globe-scene"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? [1, 0.88, 22] : 1, // Faster recoil and bigger expansion
                            opacity: phase === 'burst' ? [1, 1, 0] : 1,
                        }}
                        exit={{ opacity: 0, scale: 30 }}
                        transition={{ 
                            duration: phase === 'burst' ? 2.5 : 1.2,
                            times: phase === 'burst' ? [0, 0.08, 1] : undefined,
                            type: "spring",
                            stiffness: 45,
                            damping: 12,
                            mass: 1.2
                        }}
                        className="relative z-10 flex items-center justify-center transform-gpu will-change-transform"
                    >
                        {phase === 'burst' && (
                            <>
                                <EnergyVortex />
                                <Shockwaves />
                                <motion.div 
                                    className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8)_0%,rgba(34,211,238,0.4)_40%,transparent_70%)] z-0"
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ 
                                        scale: [0, 25], 
                                        opacity: [0, 1, 0],
                                    }}
                                    transition={{ duration: 2.2, ease: "easeOut" }}
                                />
                            </>
                        )}
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
                            layoutId="logo-main"
                            initial={{ scale: 1.1, opacity: 0, filter: 'blur(15px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ type: "spring", stiffness: 40, damping: 15, mass: 1.4 }}
                            className="flex flex-col items-center gap-8 relative"
                        >
                            <Logo className="scale-[2.6]" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {phase === 'burst' && (
                <>
                    <LensFlare />
                    <motion.div 
                        className="absolute inset-0 bg-white/60 z-[10000] mix-blend-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 1, 0.9, 0] }}
                        transition={{ duration: 0.5, times: [0, 0.15, 0.3, 1] }}
                    />
                    <motion.div 
                        className="absolute inset-0 z-[10001] pointer-events-none"
                        animate={{ 
                            x: [0, -30, 30, -15, 15, 0],
                            y: [0, 15, -15, 8, -8, 0],
                            filter: ['blur(0px)', 'blur(15px)', 'blur(0px)']
                        }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                    />
                </>
            )}
        </motion.div>
    );
};

export default SplashScreen;
