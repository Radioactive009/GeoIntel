import React, { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useAnimationFrame, useMotionValue, useTransform } from 'framer-motion';
import Logo from './Logo';

// Optimized 1K Textures
const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_1024.jpg";
const CLOUD_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_1024.png";

// ── Technical Grid Background ─────────────────────────────
const CyberGrid = () => (
    <div className="absolute inset-0 pointer-events-none z-0">
        <div 
            className="absolute inset-0 opacity-[0.03]"
            style={{
                backgroundImage: `linear-gradient(to right, #22d3ee 1px, transparent 1px), linear-gradient(to bottom, #22d3ee 1px, transparent 1px)`,
                backgroundSize: '40px 40px',
                maskImage: 'radial-gradient(circle at center, black, transparent 80%)'
            }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#22d3ee05] to-transparent animate-pulse" />
    </div>
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
            delay: Math.random() * 5
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

const UltraRealGlobe = ({ speedFactor, isBursting }) => {
    // raw values for logic
    const surfacePos = useMotionValue(0);
    const cloudPos = useMotionValue(0);
    
    // Derived percentage strings for visual linkage
    const xSurface = useTransform(surfacePos, (v) => `${v}%`);
    const xCloud = useTransform(cloudPos, (v) => `${v}%`);

    useAnimationFrame((time, delta) => {
        if (isBursting) return;
        
        // Accurate movement based on frame-delta
        const sMove = (delta * 0.005) * speedFactor;
        const cMove = (delta * 0.006) * speedFactor;

        // Loop from 0 to -50 (since we have 2 side-by-side images)
        let nextS = surfacePos.get() - sMove;
        if (nextS <= -50) nextS = 0;
        
        let nextC = cloudPos.get() - cMove;
        if (nextC <= -50) nextC = 0;

        surfacePos.set(nextS);
        cloudPos.set(nextC);
    });

    return (
        <div className="relative flex items-center justify-center scale-110 will-change-transform">
            {/* Atmosphere Bloom */}
            <div className={`absolute inset-0 rounded-full bg-blue-600/10 blur-[100px] transition-opacity duration-1000 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            {/* The Sphere */}
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden border border-white/10 shadow-2xl bg-black transform-gpu">
                
                {/* Surface Layer - Linked directly to MotionValue */}
                <motion.div 
                    style={{ x: xSurface }}
                    className="absolute inset-y-0 left-0 flex brightness-110 contrast-125 saturate-125"
                >
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                </motion.div>
                
                {/* Cloud Layer - Linked directly to MotionValue */}
                <motion.div 
                    style={{ x: xCloud }}
                    className="absolute inset-y-0 left-0 flex opacity-40 mix-blend-screen scale-[1.02]"
                >
                    <img src={CLOUD_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                    <img src={CLOUD_TEXTURE} alt="" className="h-full w-auto max-w-none" />
                </motion.div>

                {/* Shading */}
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.08)_0%,rgba(0,0,0,0)_45%,rgba(0,0,0,0.7)_75%,rgba(0,0,0,1)_100%)]" />
                
                {/* Atmospheric Fresnel */}
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_0_60px_rgba(34,211,238,0.3),inset_0_0_120px_rgba(59,130,246,0.1)] opacity-70" />
            </div>

            {/* Atmosphere Ring */}
            <div className={`absolute -inset-2 rounded-full border-[2px] border-blue-400/20 blur-[2px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speedFactor, setSpeedFactor] = useState(1); 

    useEffect(() => {
        const sequence = async () => {
            // majestic entry
            await new Promise(r => setTimeout(r, 2200));
            
            // Phase 2: Acceleration
            setPhase('accelerating');
            setSpeedFactor(6); 
            
            await new Promise(r => setTimeout(r, 2200));
            setPhase('burst');
            
            await new Promise(r => setTimeout(r, 1000));
            setPhase('logo');
            
            await new Promise(r => setTimeout(r, 2500));
            setPhase('moving');
            
            await new Promise(r => setTimeout(r, 1200));
            onComplete();
        };
        sequence();
    }, [onComplete]);

    return (
        <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#00040d] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
        >
            <Starfield />

            {(phase === 'logo' || phase === 'moving') && <CyberGrid />}

            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <filter id="bloom">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </svg>

            <AnimatePresence mode="wait">
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-scene"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 18 : 1,
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(15) blur(20px)' : 'brightness(1) blur(0px)'
                        }}
                        transition={{ 
                            duration: phase === 'burst' ? 1 : 2.5,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative z-10"
                        style={{ filter: 'url(#bloom)' }}
                    >
                        <UltraRealGlobe speedFactor={speedFactor} isBursting={phase === 'burst'} />
                    </motion.div>
                )}

                {(phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="site-intro"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1.2 }}
                        className="absolute inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
                    >
                        <motion.div 
                            className="absolute top-0 w-full h-1 bg-cyan-400/40 blur-sm shadow-[0_0_20px_rgba(34,211,238,0.6)]"
                            initial={{ top: '0%' }}
                            animate={{ top: '100%' }}
                            transition={{ duration: 1.2, repeat: 2, ease: "linear" }}
                        />

                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 1.1, opacity: 0, filter: 'blur(15px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ 
                                type: "spring", stiffness: 45, damping: 15, mass: 1.4
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
                    className="absolute inset-0 bg-cyan-300/60 z-[10000]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 0.8 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
