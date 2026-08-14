import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Radio, X } from 'lucide-react';
import CountryBadge from './CountryBadge';

/**
 * Channel picker.
 *
 * Replaces a horizontally-scrolling rail of chips, which stopped working as a
 * navigation surface once the catalog passed a couple of dozen channels — the
 * viewer had to scrub sideways past everything to reach anything.
 *
 * Built as a custom listbox rather than a native <select> so each row can carry
 * a flag, the country, and a live indicator, and so it matches the dashboard's
 * dark glass styling (native option lists cannot be styled cross-browser).
 * Keyboard and click-outside behaviour are implemented to match what a native
 * select would do.
 */
const ChannelSelect = ({ channels = [], offline = [], activeId, onSelect }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [dropUp, setDropUp] = useState(false);

    const containerRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const active = channels.find((c) => c.id === activeId) || channels[0] || null;

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return channels;
        return channels.filter((c) =>
            [c.name, c.country, c.country_iso_code, c.live_title]
                .filter(Boolean)
                .some((field) => field.toLowerCase().includes(q))
        );
    }, [channels, query]);

    const offlineMatches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return offline;
        return offline.filter((c) =>
            [c.name, c.country].filter(Boolean).some((f) => f.toLowerCase().includes(q))
        );
    }, [offline, query]);

    // Close on outside click or Escape, like a native select.
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const PANEL_HEIGHT = 380; // search + list max-height + footer

    useEffect(() => {
        if (open) {
            setQuery('');
            setCursor(Math.max(0, matches.findIndex((c) => c.id === activeId)));
            // Open upward when the panel would spill past the viewport bottom
            // and there is more room above.
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
                const below = window.innerHeight - rect.bottom;
                setDropUp(below < PANEL_HEIGHT && rect.top > below);
            }
            // Focus after paint so the panel is mounted.
            requestAnimationFrame(() => inputRef.current?.focus());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Keep the highlighted row in view while arrowing through a long list.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-idx="${cursor}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [cursor, open]);

    const commit = (channel) => {
        onSelect(channel);
        setOpen(false);
    };

    const onKeyDown = (e) => {
        if (!open) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((i) => Math.min(i + 1, matches.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (matches[cursor]) commit(matches[cursor]);
        }
    };

    if (!channels.length) return null;

    return (
        <div ref={containerRef} className="relative" onKeyDown={onKeyDown}>
            {/* Trigger */}
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-300 text-left group ${
                    open
                        ? 'bg-slate-900/80 border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                        : 'bg-slate-900/50 border-white/8 hover:border-white/20'
                }`}
            >
                <CountryBadge code={active?.country_iso_code} size="lg" title={active?.country} />

                <span className="flex-grow min-w-0">
                    <span className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white truncate">
                            {active?.name || 'Select a channel'}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                            <span className="text-[9px] font-extrabold text-rose-400 uppercase tracking-widest">
                                Live
                            </span>
                        </span>
                    </span>
                    <span className="block text-[11px] text-slate-500 font-medium truncate mt-0.5">
                        {active?.country || 'Global'}
                        {active?.live_title ? ` · ${active.live_title}` : ''}
                    </span>
                </span>

                <ChevronDown
                    size={16}
                    className={`shrink-0 text-slate-500 group-hover:text-cyan-400 transition-all duration-300 ${
                        open ? 'rotate-180 text-cyan-400' : ''
                    }`}
                />
            </button>

            {/* Panel */}
            {open && (
                <div
                    // Explicit opaque hex, not a slash-opacity utility: the panel
                    // floats over the stat cards, and any translucency lets their
                    // headings bleed through the list rows.
                    className={`absolute z-50 left-0 right-0 rounded-2xl border border-white/10 bg-[#070d1a] shadow-2xl shadow-black/70 overflow-hidden animate-fade-in ${
                        dropUp ? 'bottom-full mb-2' : 'mt-2'
                    }`}
                >
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
                        <Search size={13} className="text-slate-500 shrink-0" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
                            placeholder="Search channels or countries…"
                            className="flex-grow bg-transparent text-xs text-white placeholder:text-slate-600 outline-none font-medium"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                                className="text-slate-500 hover:text-white transition-colors"
                                aria-label="Clear search"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    <div ref={listRef} className="max-h-[290px] overflow-y-auto chart-scrollbar py-1" role="listbox">
                        {matches.length === 0 && offlineMatches.length === 0 && (
                            <p className="px-4 py-6 text-center text-[11px] text-slate-600 font-medium">
                                No channels match “{query}”.
                            </p>
                        )}

                        {matches.map((channel, i) => {
                            const isActive = channel.id === active?.id;
                            const isCursor = i === cursor;
                            return (
                                <button
                                    key={channel.id}
                                    data-idx={i}
                                    role="option"
                                    aria-selected={isActive}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => commit(channel)}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                        isCursor ? 'bg-white/[0.07]' : ''
                                    } ${isActive ? 'bg-cyan-500/10' : ''}`}
                                >
                                    <CountryBadge code={channel.country_iso_code} size="md" title={channel.country} />
                                    <span className="flex-grow min-w-0">
                                        <span className={`block text-xs font-bold truncate ${isActive ? 'text-cyan-300' : 'text-white'}`}>
                                            {channel.name}
                                        </span>
                                        <span className="block text-[10px] text-slate-500 font-medium truncate">
                                            {channel.country || 'Global'}
                                            {channel.live_title ? ` · ${channel.live_title}` : ''}
                                        </span>
                                    </span>
                                    <Radio size={11} className="text-rose-500 shrink-0" />
                                </button>
                            );
                        })}

                        {offlineMatches.length > 0 && (
                            <>
                                <p className="px-3 pt-3 pb-1.5 text-[9px] font-extrabold text-slate-600 uppercase tracking-[0.2em]">
                                    Offline · {offlineMatches.length}
                                </p>
                                {offlineMatches.map((channel) => (
                                    <div
                                        key={channel.id}
                                        className="w-full flex items-center gap-3 px-3 py-2 opacity-40 cursor-not-allowed"
                                        title="Not streaming right now"
                                    >
                                        <CountryBadge code={channel.country_iso_code} size="md" className="grayscale" title={channel.country} />
                                        <span className="flex-grow min-w-0">
                                            <span className="block text-xs font-bold text-slate-400 truncate">
                                                {channel.name}
                                            </span>
                                            <span className="block text-[10px] text-slate-600 font-medium truncate">
                                                {channel.country || 'Global'}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                            {channels.length} live
                        </span>
                        <span className="text-[9px] text-slate-700 font-medium">↑↓ navigate · ↵ select · esc close</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ChannelSelect;
