import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo';

const GlobeSVG = ({ rotationSpeed }) => (
    <motion.svg
        width="200"
        height="200"
        viewBox="0 0 100 100"
        animate={{ rotate: 360 }}
        transition={{
            duration: rotationSpeed,
            repeat: Infinity,
            ease: "linear"
        }}
        className="text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]"
    >
        <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.3" />
        <path
            d="M50 2A48 48 0 0 1 50 98M50 2A48 48 0 0 0 50 98M2 50A48 48 0 0 1 98 50M2 50A48 48 0 0 0 98 50"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.5"
        />
        {/* Simplified Continents */}
        <path
            d="M30 30c5-5 15-5 20 0s5 15 0 20-15 5-20 0-5-15 0-20zM70 60c3-3 8-3 11 0s3 8 0 11-8 3-11 0-3-8 0-11zM40 70c4-4 10-4 14 0s4 10 0 14-10 4-14 0-4-10 0-14z"
            fill="currentColor"
            opacity="0.8"
        />
        <motion.circle
            cx="50"
            cy="50"
            r="48"
            fill="url(#globeGradient)"
            initial={{ opacity: 0.1 }}
        />
        <defs>
            <radialGradient id="globeGradient">
                <stop offset="0%" stopColor="rgba(34,211,238,0.4)" />
                <stop offset="100%" stopColor="rgba(34,211,238,0)" />
            </radialGradient>
        </defs>
    </motion.svg>
);

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning'); // spinning, accelerating, burst, whiteout, logo, final

    useEffect(() => {
        const sequence = async () => {
            // Phase 1: Spin slowly (2s)
            await new Promise(r => setTimeout(r, 2000));
            setPhase('accelerating');

            // Phase 2: Accelerate (1.5s)
            await new Promise(r => setTimeout(r, 1500));
            setPhase('burst');

            // Phase 3: Burst (0.5s)
            await new Promise(r => setTimeout(r, 500));
            setPhase('whiteout');

            // Phase 4: Whiteout -> Logo Reveal (0.5s)
            await new Promise(r => setTimeout(r, 500));
            setPhase('logo');

            // Phase 5: Logo stays (1.5s)
            await new Promise(r => setTimeout(r, 1500));
            setPhase('moving');

            // Phase 6: Complete
            await new Promise(r => setTimeout(r, 1000));
            onComplete();
        };

        sequence();
    }, [onComplete]);

    return (
        <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-slate-950"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
        >
            <AnimatePresence mode="wait">
                {/* Globe Phases */}
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-container"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 25 : 1, 
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(5)' : 'brightness(1)'
                        }}
                        exit={{ opacity: 0 }}
                        transition={{ 
                            duration: phase === 'burst' ? 0.6 : 1,
                            ease: phase === 'burst' ? "easeIn" : "easeOut"
                        }}
                        className="relative"
                    >
                        <GlobeSVG rotationSpeed={phase === 'accelerating' ? 0.5 : 4} />
                    </motion.div>
                )}

                {/* Whiteout / Logo Reveal */}
                {(phase === 'whiteout' || phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="overlay"
                        initial={{ opacity: 0 }}
                        animate={{ 
                            opacity: 1,
                            backgroundColor: phase === 'moving' ? 'rgba(2, 6, 23, 0)' : '#f8fafc' 
                        }}
                        transition={{ duration: 0.8 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        {phase !== 'whiteout' && (
                            <motion.div
                                layoutId="logo-main"
                                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                animate={{ opacity: 1, scale: 1.2, y: 0 }}
                                transition={{ 
                                    type: "spring",
                                    stiffness: 100,
                                    damping: 20
                                }}
                            >
                                <Logo showText={true} className="scale-150" />
                            </motion.div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Background Transition Hint (Flash of white) */}
            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-white"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.4 }}
                    transition={{ duration: 0.4 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
