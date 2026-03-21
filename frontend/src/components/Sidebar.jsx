import React from 'react';
import { Filter, ChevronDown, XCircle, Globe, MapPin, Cpu } from 'lucide-react';

const Sidebar = ({
    countries,
    regions,
    selectedCountry,
    selectedRegion,
    onCountryChange,
    onRegionChange,
    onReset
}) => {
    return (
        <aside className="w-full lg:w-72 flex-shrink-0 transition-all duration-500">
            <div className="glass rounded-3xl p-6 sticky top-24 space-y-8 animate-fade-in-up">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                            <Filter size={16} className="text-cyan-400" />
                        </div>
                        <span className="text-sm font-bold text-white uppercase tracking-wider">Intelligence Filters</span>
                    </div>
                    {(selectedCountry || selectedRegion) && (
                        <button
                            onClick={onReset}
                            className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors active:scale-90"
                            title="Reset Filters"
                        >
                            <XCircle size={18} />
                        </button>
                    )}
                </div>

                {/* Filters Group */}
                <div className="space-y-6">
                    {/* Region Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Globe size={12} className="text-slate-500" />
                            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-[0.2em]">Select Region</label>
                        </div>
                        <select
                            value={selectedRegion}
                            onChange={(e) => onRegionChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-cyan-500/30 transition-colors"
                        >
                            <option value="">Global Coverage</option>
                            {regions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>

                    {/* Country Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <MapPin size={12} className="text-slate-500" />
                            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-[0.2em]">Select Country</label>
                        </div>
                        <select
                            value={selectedCountry}
                            onChange={(e) => onCountryChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-cyan-500/30 transition-colors"
                        >
                            <option value="">All Operational Zones</option>
                            {countries.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {/* System Info */}
                <div className="pt-6 border-t border-white/5">
                    <div className="p-4 rounded-2xl bg-slate-900/40 border border-white/5 space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-emerald-500/10">
                                <Cpu size={14} className="text-emerald-400" />
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">AI Processor</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-slate-500">Sentiment Model</span>
                            <span className="text-[10px] font-bold text-emerald-400">FINBERT-04</span>
                        </div>
                        <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-emerald-500 transition-all duration-1000 ease-out"
                                style={{ width: '85%' }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
