import React, { useState } from 'react';
import { RefreshCw, Shield, Zap, Radio, Menu, X } from 'lucide-react';
import { motion } from 'framer-motion';
import Logo from './Logo';

const Navbar = ({ onRefresh, isRefreshing }) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <nav className="sticky top-0 z-50 glass-strong border-b border-white/5 bg-background/80 backdrop-blur-xl">
            <div className="max-w-[1440px] mx-auto flex items-center justify-between px-6 py-4">
                {/* Logo */}
                <motion.div 
                    layoutId="logo-main"
                    className="transition-transform duration-300 hover:scale-105 active:scale-95 cursor-pointer"
                    transition={{ type: "spring", stiffness: 100, damping: 20 }}
                >
                    <Logo />
                </motion.div>

                {/* Desktop Actions */}
                <div className="hidden md:flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/50 border border-white/5">
                        <Radio size={14} className="text-emerald-400 animate-pulse" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Feed</span>
                    </div>

                    <div className="h-6 w-[1px] bg-white/10 mx-2" />

                    <button
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        className="btn-primary flex items-center gap-2 transition-all duration-300 active:scale-95"
                    >
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        <span className="text-xs">{isRefreshing ? 'Syncing...' : 'Refresh Data'}</span>
                    </button>
                </div>

                {/* Mobile Menu Toggle */}
                <button 
                    className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                >
                    {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Mobile Menu Dropdown */}
            <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${isMobileMenuOpen ? 'max-h-64 border-t border-white/5' : 'max-h-0'}`}>
                <div className="px-6 py-6 space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">System Status</span>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                            <span className="text-xs font-bold text-emerald-400">ONLINE</span>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            onRefresh();
                            setIsMobileMenuOpen(false);
                        }}
                        disabled={isRefreshing}
                        className="w-full btn-primary flex items-center justify-center gap-2 py-3"
                    >
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        <span>{isRefreshing ? 'Syncing Intelligence...' : 'Refresh All Feeds'}</span>
                    </button>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
