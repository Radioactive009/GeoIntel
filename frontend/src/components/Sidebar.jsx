import { useEffect, useState } from 'react';
import { Filter, XCircle, Globe, MapPin, Cpu, AlertTriangle, Search, X, Calendar, Crosshair } from 'lucide-react';

const RISK_LEVELS = [
    { id: '', label: 'All risk levels' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' },
];

const EVENT_TYPES = [
    { id: '', label: 'All event types' },
    { id: 'conflict', label: 'Conflict' },
    { id: 'security', label: 'Security' },
    { id: 'diplomacy', label: 'Diplomacy' },
    { id: 'economy', label: 'Economy' },
    { id: 'politics', label: 'Politics' },
    { id: 'disaster', label: 'Disasters' },
    { id: 'humanitarian', label: 'Humanitarian' },
    { id: 'other', label: 'Unclassified' },
];

const TIME_RANGES = [
    { id: 0, label: 'All' },
    { id: 1, label: '24h' },
    { id: 7, label: '7d' },
    { id: 30, label: '30d' },
];

const Sidebar = ({
    countries,
    regions,
    selectedCountry,
    selectedRegion,
    selectedLevel,
    selectedEventType,
    selectedDays,
    searchTerm,
    onCountryChange,
    onRegionChange,
    onLevelChange,
    onEventTypeChange,
    onDaysChange,
    onSearchChange,
    onReset,
    stats,
}) => {
    const hasFilters = Boolean(
        selectedCountry || selectedRegion || selectedLevel
        || selectedEventType || selectedDays || searchTerm
    );

    // Local mirror so typing stays responsive; the committed value is
    // debounced upward so the feed is not refetched on every keystroke.
    const [draft, setDraft] = useState(searchTerm);
    useEffect(() => { setDraft(searchTerm); }, [searchTerm]);
    useEffect(() => {
        if (draft === searchTerm) return undefined;
        const timer = setTimeout(() => onSearchChange(draft), 350);
        return () => clearTimeout(timer);
    }, [draft, searchTerm, onSearchChange]);
    const total = stats?.total_articles || 0;
    const highCount = stats?.by_risk_level?.high || 0;
    // Share of the corpus currently flagged critical.
    const highShare = total > 0 ? Math.round((highCount / total) * 100) : 0;

    return (
        <aside className="w-full lg:w-72 flex-shrink-0 transition-all duration-500">
            <div className="glass rounded-2xl p-6 sticky top-24 space-y-8 animate-fade-in-up">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-accent-soft border border-accent/50">
                            <Filter size={16} className="text-accent" />
                        </div>
                        <span className="text-sm font-bold text-ink uppercase tracking-wider">Filter stories</span>
                    </div>
                    {hasFilters && (
                        <button
                            onClick={onReset}
                            className="p-1.5 text-muted hover:text-risk-high transition-colors active:scale-90"
                            title="Clear all filters"
                        >
                            <XCircle size={18} />
                        </button>
                    )}
                </div>

                {/* Filters Group */}
                <div className="space-y-6">
                    {/* Keyword search */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Search size={12} className="text-muted" />
                            <label htmlFor="feed-search" className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">
                                Keyword Search
                            </label>
                        </div>
                        <div className="relative">
                            <input
                                id="feed-search"
                                type="search"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder="e.g. sanctions, Kyiv…"
                                className="input-field w-full pr-9 hover:border-accent transition-colors"
                            />
                            {draft && (
                                <button
                                    onClick={() => { setDraft(''); onSearchChange(''); }}
                                    aria-label="Clear search"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Time range */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Calendar size={12} className="text-muted" />
                            <label className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">Time range</label>
                        </div>
                        <div className="flex bg-surface p-1 rounded-xl border border-rule gap-1">
                            {TIME_RANGES.map((range) => (
                                <button
                                    key={range.id}
                                    onClick={() => onDaysChange(range.id)}
                                    className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                        selectedDays === range.id
                                            ? 'bg-accent text-ink shadow-lg shadow-transparent'
                                            : 'text-muted hover:text-body'
                                    }`}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Region Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Globe size={12} className="text-muted" />
                            <label className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">Region</label>
                        </div>
                        <select
                            value={selectedRegion}
                            onChange={(e) => onRegionChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-accent transition-colors"
                        >
                            <option value="">All regions</option>
                            {regions.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>

                    {/* Country Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <MapPin size={12} className="text-muted" />
                            <label className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">Country</label>
                        </div>
                        <select
                            value={selectedCountry}
                            onChange={(e) => onCountryChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-accent transition-colors"
                        >
                            <option value="">All countries</option>
                            {countries.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    {/* Risk level */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <AlertTriangle size={12} className="text-muted" />
                            <label className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">Risk level</label>
                        </div>
                        <select
                            value={selectedLevel}
                            onChange={(e) => onLevelChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-accent transition-colors"
                        >
                            {RISK_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                        </select>
                    </div>

                    {/* Event Type Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <Crosshair size={12} className="text-muted" />
                            <label className="text-[10px] uppercase font-bold text-muted tracking-[0.2em]">Event type</label>
                        </div>
                        <select
                            value={selectedEventType}
                            onChange={(e) => onEventTypeChange(e.target.value)}
                            className="input-field w-full cursor-pointer pr-10 hover:border-accent transition-colors"
                        >
                            {EVENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* System Info — real pipeline numbers, not a hardcoded bar */}
                <div className="pt-6 border-t border-rule">
                    <div className="p-4 rounded-2xl bg-surface border border-rule space-y-3">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-risk-low">
                                <Cpu size={14} className="text-risk-low" />
                            </div>
                            <span className="text-[11px] font-bold text-body uppercase tracking-widest leading-none">Scoring</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted">Method</span>
                            <span className="text-[10px] font-bold text-risk-low">Keywords + sentiment</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted">Stories scored</span>
                            <span className="text-[10px] font-bold text-body tabular-nums">{total}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted">Share high risk</span>
                            <span className="text-[10px] font-bold text-risk-high tabular-nums">{highShare}%</span>
                        </div>
                        <div className="w-full h-1 bg-surface-sunken rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-risk-low to-risk-high transition-all duration-1000 ease-out"
                                style={{ width: `${Math.max(highShare, 2)}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
