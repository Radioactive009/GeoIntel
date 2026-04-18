import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import Logo from './Logo';

// Photo-realistic Earth Texture (High Resolution - using a stable Three.js asset)
const EARTH_TEXTURE = "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg";

const RealisticGlobe = ({ speed }) => {
    const x = useMotionValue(0);

    useEffect(() => {
        // Linear seamless rotation
        const controls = animate(x, -100, {
            duration: speed,
            ease: "linear",
            repeat: Infinity,
        });
        return controls.stop;
    }, [x, speed]);

    return (
        <div className="relative w-[340px] h-[340px] flex items-center justify-center">
            {/* Atmospheric Outer Glow */}
            <div className="absolute inset-x-0 inset-y-0 rounded-full border-[10px] border-blue-500/20 blur-xl animate-pulse" />
            <div className="absolute inset-x-0 inset-y-0 rounded-full border-[2px] border-cyan-400/30 blur-sm" />
            
            {/* The Sphere Container */}
            <div className="relative w-[300px] h-[300px] rounded-full overflow-hidden shadow-[0_0_80px_rgba(59,130,246,0.25)] border border-white/10 flex items-center">
                
                {/* Rotating Texture Layer */}
                <motion.div 
                    style={{ x, display: 'flex' }}
                    className="h-full w-[200%] grayscale-[0.2] contrast-[1.1] brightness-[0.9]"
                >
                    <img 
                        src={EARTH_TEXTURE} 
                        alt="Earth Map" 
                        className="h-full w-1/2 object-cover"
                    />
                    <img 
                        src={EARTH_TEXTURE} 
                        alt="Earth Map" 
                        className="h-full w-1/2 object-cover"
                    />
                </motion.div>

                {/* Night-side / Shadow Overlay */}
                <div 
                    className="absolute inset-0 pointer-events-none" 
                    style={{
                        background: 'radial-gradient(circle at 35% 35%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.9) 100%)'
                    }}
                />

                {/* Fresnel Effect (Atmospheric Rim Light) */}
                <div 
                    className="absolute inset-0 pointer-events-none rounded-full" 
                    style={{
                        boxShadow: 'inset 0 0 50px rgba(34, 211, 238, 0.4), inset 0 0 100px rgba(59, 130, 246, 0.2)'
                    }}
                />
            </div>

            {/* Orbiting Satellite Dots (Optional for tech feel) */}
            <motion.div 
                className="absolute w-[360px] h-[360px] border border-cyan-500/5 rounded-full"
                animate={{ rotate: 360 }}
                transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            />
        </div>
    );
};

const SplashScreen = ({ onComplete }) => {
    const [phase, setPhase] = useState('spinning');
    const [speed, setSpeed] = useState(15); // Slower for realistic globe

    useEffect(() => {
        const runSequence = async () => {
            // Initial reveal
            await new Promise(r => setTimeout(r, 2500));
            
            // Accelerate
            setPhase('accelerating');
            setSpeed(2.5);
            
            await new Promise(r => setTimeout(r, 1800));
            setPhase('burst');
            
            await new Promise(r => setTimeout(r, 800));
            setPhase('logo');
            
            await new Promise(r => setTimeout(r, 2000));
            setPhase('moving');
            
            await new Promise(r => setTimeout(r, 1200));
            onComplete();
        };

        runSequence();
    }, [onComplete]);

    return (
        <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#020617] overflow-hidden"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
        >
            <AnimatePresence mode="wait">
                {(phase === 'spinning' || phase === 'accelerating' || phase === 'burst') && (
                    <motion.div
                        key="globe-wrap"
                        initial={{ scale: 0.8, opacity: 0, filter: 'blur(20px)' }}
                        animate={{ 
                            scale: phase === 'burst' ? 12 : 1,
                            opacity: phase === 'burst' ? 0 : 1,
                            filter: phase === 'burst' ? 'brightness(15) blur(30px)' : 'brightness(1) blur(0px)'
                        }}
                        transition={{ 
                            duration: phase === 'burst' ? 0.9 : 1.5,
                            ease: phase === 'burst' ? [0.4, 0, 0.2, 1] : "easeOut"
                        }}
                        className="relative"
                    >
                        <RealisticGlobe speed={speed} />
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
                        transition={{ duration: 1 }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <motion.div
                            layoutId="logo-main"
                            initial={{ scale: 0.7, opacity: 0, y: 30 }}
                            animate={{ scale: 1.3, opacity: 1, y: 0 }}
                            transition={{ 
                                type: "spring",
                                stiffness: 70,
                                damping: 18
                            }}
                        >
                            <Logo className="scale-125" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cinematic High-Exposure Flash */}
            {phase === 'burst' && (
                <motion.div 
                    className="absolute inset-0 bg-white z-[10000]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                />
            )}
        </motion.div>
    );
};

export default SplashScreen;
