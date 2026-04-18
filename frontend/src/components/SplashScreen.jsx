import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import Logo from './Logo';

const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg";

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
                    animate={{ 
                        opacity: [0.1, 0.4, 0.1],
                        scale: [1, 1.2, 1]
                    }}
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

// ── HUD Elements ──────────────────────────────────────────
const GlobeHUD = ({ rotationX }) => {
    return (
        <div className="absolute inset-0 pointer-events-none z-20">
            <svg viewBox="0 0 100 100" className="w-[305px] h-[305px] absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-20">
                <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(34, 211, 238, 0.5)" strokeWidth="0.2" />
                <motion.g style={{ x: rotationX }}>
                    {[0, 20, 40, 60, 80, 100, 120, 140, 160].map(x => (
                        <line key={x} x1={x} y1="2" x2={x} y2="98" stroke="rgba(34, 211, 238, 0.3)" strokeWidth="0.1" />
                    ))}
                </motion.g>
                <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(34, 211, 238, 0.3)" strokeWidth="0.1" />
            </svg>

            <motion.div 
                className="absolute top-1/4 -right-12 space-y-1 text-[#22d3ee]/40 font-mono text-[8px] uppercase tracking-tighter"
                animate={{ opacity: [0.2, 0.5, 0.2] }}
                transition={{ duration: 2, repeat: Infinity }}
            >
                <p>LAT: 35.6895° N</p>
                <p>LNG: 139.6917° E</p>
                <p>SEC: 07 // NOD: ACTIVE</p>
            </motion.div>
        </div>
    );
};

const PremiumGlobe = ({ speed, isBursting }) => {
    const x = useMotionValue(0);

    useEffect(() => {
        const controls = animate(x, -100, {
            duration: speed,
            ease: "linear",
            repeat: Infinity,
        });
        return controls.stop;
    }, [x, speed]);

    return (
        <div className="relative flex items-center justify-center will-change-transform scale-110">
            <div className={`absolute inset-0 rounded-full bg-blue-600/10 blur-[100px] transition-opacity duration-1000 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            <div className={`absolute -inset-4 rounded-full bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 blur-[20px] shadow-[0_0_100px_rgba(59,130,246,0.3)] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden border border-white/10 shadow-2xl flex items-center bg-black">
                <motion.div style={{ x }} className="h-full w-[200%] flex brightness-110 contrast-125 saturate-125 will-change-transform">
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-1/2 object-cover" />
                    <img src={EARTH_TEXTURE} alt="" className="h-full w-1/2 object-cover" />
                </motion.div>
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.1)_0%,rgba(0,0,0,0)_40%,rgba(0,0,0,0.6)_70%,rgba(0,0,0,0.95)_100%)]" />
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_0_80px_rgba(34,211,238,0.4),inset_0_0_150px_rgba(59,130,246,0.2)]" />
            </div>

            {!isBursting && <GlobeHUD rotationX={x} />}
            <div className={`absolute -inset-2 rounded-full border-[3px] border-cyan-400/10 blur-[4px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speed, setSpeed] = useState(25);

    useEffect(() => {
        const sequence = async () => {
            await new Promise(r => setTimeout(r, 2000));
            setPhase('accelerating');
            setSpeed(4);
            await new Promise(r => setTimeout(r, 2000));
            setPhase('burst');
            await new Promise(r => setTimeout(r, 600));
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
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#000511] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
        >
            <Starfield />

            {/* Replace white with tech patterns */}
            {(phase === 'logo' || phase === 'moving') && <CyberGrid />}

            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
                <filter id="bloom">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </svg>

            <AnimatePresence mode="wait">
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-scene"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 15 : 1,
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(15) blur(15px)' : 'brightness(1) blur(0px)'
                        }}
                        transition={{ 
                            duration: phase === 'burst' ? 0.7 : 2,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative z-10"
                        style={{ filter: 'url(#bloom)' }}
                    >
                        <PremiumGlobe speed={speed} isBursting={phase === 'burst'} />
                    </motion.div>
                )}

                {(phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="site-intro"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 flex flex-col items-center justify-center z-50 pointer-events-none"
                    >
                        {/* Technical Assembly Scan Line Overlay */}
                        <motion.div 
                            className="absolute top-0 w-full h-1 bg-cyan-500/30 blur-sm shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                            initial={{ top: '0%' }}
                            animate={{ top: '100%' }}
                            transition={{ duration: 1, repeat: 2, ease: "linear" }}
                        />

                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 1.5, opacity: 0, filter: 'blur(10px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ 
                                type: "spring",
                                stiffness: 45,
                                damping: 15,
                                mass: 1.2
                            }}
                            className="flex flex-col items-center gap-8 relative"
                        >
                            {/* Faint Technical Ring behind logo */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full border border-cyan-500/10 animate-pulse" />
                            
                            <Logo className="scale-[2.4]" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Subtle light pulse instead of white flash */}
            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-cyan-400/50 z-[10000]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 0.6 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
