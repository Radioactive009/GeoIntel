import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo';

const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg";
const CLOUD_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_2048.png";

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
const GlobeHUD = () => {
    const [stats, setStats] = useState({ lat: 35.6895, lng: 139.6917 });

    useEffect(() => {
        const interval = setInterval(() => {
            setStats({
                lat: (35.6895 + Math.random() * 2).toFixed(4),
                lng: (139.6917 + Math.random() * 2).toFixed(4)
            });
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="absolute inset-0 pointer-events-none z-20">
            {/* Latitude/Longitude Grid (Static Rotation to match globe feel) */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[310px] h-[310px] opacity-20 border border-cyan-500/20 rounded-full">
                <div className="absolute inset-0 border-t border-cyan-500/30 top-1/2 -translate-y-1/2" />
                <div className="absolute inset-0 border-l border-cyan-500/30 left-1/2 -translate-x-1/2" />
            </div>

            <motion.div 
                className="absolute top-1/4 -right-16 space-y-1 text-[#22d3ee]/60 font-mono text-[9px] uppercase tracking-widest bg-slate-900/40 backdrop-blur-sm p-3 rounded-lg border border-cyan-500/20"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
            >
                <div className="flex justify-between gap-4"><span>LAT:</span> <span className="text-white">{stats.lat}° N</span></div>
                <div className="flex justify-between gap-4"><span>LNG:</span> <span className="text-white">{stats.lng}° E</span></div>
                <div className="h-px bg-cyan-500/20 my-1" />
                <p className="text-cyan-400">STATUS: SCANNING...</p>
            </motion.div>
        </div>
    );
};

const UltraRealGlobe = ({ rotationSpeed, isBursting }) => {
    return (
        <div className="relative flex items-center justify-center scale-110">
            {/* 1. Deep Space Atmosphere Glow */}
            <div className={`absolute inset-0 rounded-full bg-blue-600/10 blur-[100px] transition-opacity duration-1000 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            {/* 2. Outer Rim Light */}
            <div className={`absolute -inset-6 rounded-full bg-blue-500/5 blur-[40px] shadow-[0_0_120px_rgba(59,130,246,0.2)] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            {/* 3. The Sphere */}
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden border border-white/10 shadow-2xl bg-black transform-gpu">
                {/* Surface Layer (CSS Animation) */}
                <div 
                    className="planet-surface absolute inset-0 opacity-90 contrast-125 saturate-150"
                    style={{ 
                        backgroundImage: `url(${EARTH_TEXTURE})`,
                        '--rotation-speed': `${rotationSpeed}s`
                    }}
                />
                
                {/* Cloud Layer (Slower CSS Animation) */}
                <div 
                    className="planet-clouds absolute inset-0 opacity-40 mix-blend-screen scale-[1.02]"
                    style={{ 
                        backgroundImage: `url(${CLOUD_TEXTURE})`,
                        '--cloud-speed': `${rotationSpeed * 0.8}s`
                    }}
                />

                {/* Shading Layer (Static Lighting) */}
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.1)_0%,rgba(0,0,0,0)_45%,rgba(0,0,0,0.7)_75%,rgba(0,0,0,1)_100%)]" />
                
                {/* Atmosphere Interior Fresnel */}
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_0_60px_rgba(34,211,238,0.4),inset_0_0_120px_rgba(59,130,246,0.1)] opacity-70" />
            </div>

            {!isBursting && <GlobeHUD />}
            
            {/* 4. Atmospheric Blue Ring */}
            <div className={`absolute -inset-2 rounded-full border-[3px] border-blue-400/20 blur-[3px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speed, setSpeed] = useState(40); // Initial majestic slow crawl

    useEffect(() => {
        const sequence = async () => {
            // Give texture time to load then begin majesty
            await new Promise(r => setTimeout(r, 2000));
            
            // Phase 2: Noticeable acceleration
            setPhase('accelerating');
            setSpeed(12);
            await new Promise(r => setTimeout(r, 2500));
            
            // Phase 3: The Burst
            setPhase('burst');
            await new Promise(r => setTimeout(r, 600));
            
            // Phase 4: Intelligence Reveal
            setPhase('logo');
            await new Promise(r => setTimeout(r, 2500));
            
            // Final Move
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
                            duration: phase === 'burst' ? 0.8 : 2.5,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative z-10"
                        style={{ filter: 'url(#bloom)' }}
                    >
                        <UltraRealGlobe rotationSpeed={speed} isBursting={phase === 'burst'} />
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
                            initial={{ scale: 1.2, opacity: 0, filter: 'blur(15px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ 
                                type: "spring",
                                stiffness: 40,
                                damping: 14,
                                mass: 1.4
                            }}
                            className="flex flex-col items-center gap-8 relative"
                        >
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-cyan-500/5 animate-pulse" />
                            <Logo className="scale-[2.6]" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-cyan-300/40 z-[10000]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0] }}
                    transition={{ duration: 0.7 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
