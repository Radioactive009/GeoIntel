import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import Logo from './Logo';

// Photo-realistic Earth Texture
const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg";

const RealisticGlobe = ({ speed, isBursting }) => {
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
        <div className="relative w-[340px] h-[340px] flex items-center justify-center will-change-transform">
            {/* Ambient Atmosphere Glow */}
            <div className={`absolute inset-0 rounded-full bg-blue-500/10 blur-[60px] transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            <div className={`absolute inset-0 rounded-full border-[2px] border-cyan-400/20 blur-sm transition-opacity duration-700 ${isBursting ? 'opacity-0' : 'opacity-100'}`} />
            
            {/* The Sphere Container */}
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden shadow-[0_0_80px_rgba(59,130,246,0.15)] border border-white/5 flex items-center transform-gpu">
                
                {/* Rotating Texture Layer - Optimized with hardware acceleration */}
                <motion.div 
                    style={{ x, display: 'flex' }}
                    className="h-full w-[200%] grayscale-[0.2] contrast-[1.1] brightness-[0.9] will-change-transform"
                >
                    <img 
                        src={EARTH_TEXTURE} 
                        alt="" 
                        loading="eager"
                        className="h-full w-1/2 object-cover pointer-events-none"
                    />
                    <img 
                        src={EARTH_TEXTURE} 
                        alt="" 
                        loading="eager"
                        className="h-full w-1/2 object-cover pointer-events-none"
                    />
                </motion.div>

                {/* Lighting Overlays (optimized with simple gradients) */}
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_35%_35%,rgba(0,0,0,0)_0%,rgba(0,0,0,0.5)_60%,rgba(0,0,0,0.95)_100%)]" />
                <div className="absolute inset-0 pointer-events-none rounded-full shadow-[inset_0_0_60px_rgba(34,211,238,0.3),inset_0_0_120px_rgba(59,130,246,0.1)]" />
            </div>
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speed, setSpeed] = useState(18);

    useEffect(() => {
        const sequence = async () => {
            // Setup
            await new Promise(r => setTimeout(r, 2200));
            
            // Accelerate
            setPhase('accelerating');
            setSpeed(3);
            
            await new Promise(r => setTimeout(r, 1600));
            setPhase('burst');
            
            await new Promise(r => setTimeout(r, 700));
            setPhase('logo');
            
            await new Promise(r => setTimeout(r, 2200));
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
            <AnimatePresence mode="wait">
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-scene"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ 
                            scale: phase === 'burst' ? 10 : 1, // Reduced scale for performance
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(10) blur(10px)' : 'brightness(1) blur(0px)'
                        }}
                        transition={{ 
                            duration: phase === 'burst' ? 0.8 : 1.8,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative"
                    >
                        <RealisticGlobe speed={speed} isBursting={phase === 'burst'} />
                    </motion.div>
                )}

                {(phase === 'logo' || phase === 'moving') && (
                    <motion.div
                        key="site-intro"
                        initial={{ opacity: 0, backgroundColor: '#ffffff' }}
                        animate={{ 
                            opacity: 1,
                            backgroundColor: phase === 'moving' ? 'rgba(2,6,23,0)' : '#ffffff' 
                        }}
                        transition={{ duration: 1.2 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 1.4, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ 
                                type: "spring",
                                stiffness: 60,
                                damping: 15,
                                mass: 1.2
                            }}
                        >
                            <Logo className="scale-[1.6]" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Flash Overlay with better handling */}
            <AnimatePresence>
                {phase === 'burst' && (
                    <motion.div 
                        className="absolute inset-0 bg-white z-[10000]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default SplashScreen;
