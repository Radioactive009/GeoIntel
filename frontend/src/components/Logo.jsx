import React from 'react';
import { Shield } from 'lucide-react';

const Logo = ({ className = '', showText = true, layoutId }) => {
    return (
        <div className={`flex items-center gap-3 ${className}`}>
            <div className="relative">
                <div className="bg-gradient-to-br from-cyan-400 to-blue-600 p-2.5 rounded-xl shadow-lg shadow-cyan-500/20">
                    <Shield size={22} className="text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-background animate-pulse" />
            </div>
            {showText && (
                <div className="hidden sm:block">
                    <h1 className="text-lg font-extrabold tracking-tight text-white leading-none">
                        GEO<span className="text-cyan-400">INTEL</span>
                    </h1>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500 font-bold mt-1">Intelligence Platform</p>
                </div>
            )}
        </div>
    );
};

export default Logo;
