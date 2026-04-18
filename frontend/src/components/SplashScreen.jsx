import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useSpring, useMotionValue, animate } from 'framer-motion';
import Logo from './Logo';

const GlobeSVG = ({ speed }) => {
    // Smoother speed control using motion values
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
        <div className="relative w-[280px] h-[280px] flex items-center justify-center will-change-transform">
            {/* Ambient Glow */}
            <div className="absolute inset-0 bg-cyan-500/5 rounded-full blur-3xl" />
            
            <svg
                width="200"
                height="200"
                viewBox="0 0 100 100"
                className="relative z-10"
            >
                <defs>
                    <clipPath id="globeClip">
                        <circle cx="50" cy="50" r="48" />
                    </clipPath>
                    <radialGradient id="sphereGradient" cx="35%" cy="35%" r="65%">
                        <stop offset="0%" stopColor="rgba(34, 211, 238, 0.3)" />
                        <stop offset="60%" stopColor="rgba(15, 23, 42, 0.1)" />
                        <stop offset="100%" stopColor="rgba(2, 6, 23, 0.7)" />
                    </radialGradient>
                    <linearGradient id="continentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.7" />
                        <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.7" />
                        <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.7" />
                    </linearGradient>
                </defs>

                {/* Main Sphere Background */}
                <circle cx="50" cy="50" r="48" fill="#020617" stroke="rgba(34, 211, 238, 0.15)" strokeWidth="0.5" />
                
                {/* Rotating Continents */}
                <g clipPath="url(#globeClip)">
                    <motion.g style={{ x }}>
                        {/* Seamless Tiled Pattern */}
                        {[0, 100].map((offset) => (
                            <path
                                key={offset}
                                d={`M${offset + 10} 40c5-5 15-5 20 0s5 15 0 20-15 5-20 0-5-15 0-20z M${offset + 60} 30c8-8 20-8 28 0s8 20 0 28-20 8-28 0-8-20 0-28z M${offset + 40} 70c4-4 15-4 19 0s4 15 0 19-15 4-19 0-4-15 0-19z`}
                                fill="url(#continentGradient)"
                            />
                        ))}
                    </motion.g>
                </g>

                {/* Minimal Grid Layer */}
                <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(34, 211, 238, 0.1)" strokeWidth="0.2" strokeDasharray="1 3" />
                
                {/* 3D Shading Overlay */}
                <circle cx="50" cy="50" r="48" fill="url(#sphereGradient)" />
            </svg>

            {/* Orbiting Decor (Uses CSS for 60fps performance) */}
            <div className="absolute w-full h-full border border-cyan-500/10 rounded-full animate-slow-spin" />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speed, setSpeed] = useState(8); // Start slow

    useEffect(() => {
        const runSequence = async () => {
            // Sequence of phases
            await new Promise(r => setTimeout(r, 2000));
            
            // Accelerate smoothly
            setPhase('accelerating');
            setSpeed(1.5);
            
            await new Promise(r => setTimeout(r, 1500));
            setPhase('burst');
            
            await new Promise(r => setTimeout(r, 600));
            setPhase('logo');
            
            await new Promise(r => setTimeout(r, 1800));
            setPhase('moving');
            
            await new Promise(r => setTimeout(r, 1000));
            onComplete();
        };

        runSequence();
    }, [onComplete]);

    return (
        <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#020617] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
        >
            <AnimatePresence mode="wait">
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-wrap"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 15 : 1,
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(10) blur(20px)' : 'brightness(1) blur(0px)'
                        }}
                        transition={{ 
                            duration: phase === 'burst' ? 0.7 : 1.2,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative"
                    >
                        <GlobeSVG speed={speed} />
                    </motion.div>
                )}

                {(phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="logo-wrap"
                        initial={{ opacity: 0, backgroundColor: '#ffffff' }}
                        animate={{ 
                            opacity: 1,
                            backgroundColor: phase === 'moving' ? 'rgba(2,6,23,0)' : '#ffffff' 
                        }}
                        transition={{ duration: 0.8 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 0.8, opacity: 0, y: 10 }}
                            animate={{ scale: 1.25, opacity: 1, y: 0 }}
                            transition={{ 
                                type: "spring",
                                stiffness: 80,
                                damping: 15
                            }}
                        >
                            <Logo className="scale-125" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* High-speed whiteout flash */}
            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-white z-[10000]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
