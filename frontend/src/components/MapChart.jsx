import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import worldTopoJson from 'world-atlas/countries-110m.json';
import {
    normalizeCountry,
    geoToAlpha2,
    getGeoName,
    getAlertColorByLevel,
    matchesCountry,
} from '../utils/country';

const geoUrl = worldTopoJson;

const MapChart = ({
    alertData,
    selectedCountry,
    // Human-readable form of selectedCountry, which may itself be an ISO code.
    selectedLabel,
    onCountrySelect,
    // Adjustable so the map can align with whatever sits beside it.
    heightClass = 'h-[360px] md:h-[520px] lg:h-[640px]',
    // Optional history transport rendered beneath the legend.
    timeline = null,
    isWatched,
    onToggleWatch,
}) => {
    const [tooltip, setTooltip] = useState(null);
    const audioContextRef = useRef(null);
    const lastHoveredCountryRef = useRef('');
    const lastToneAtRef = useRef(0);
    const mapContainerRef = useRef(null);

    // An AudioContext is a real audio-device handle; leaving one open per
    // mounted map keeps the output device awake for the life of the tab.
    useEffect(() => () => {
        const ctx = audioContextRef.current;
        audioContextRef.current = null;
        if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    }, []);

    const playHoverTone = (countryName, alertLevel) => {
        const now = Date.now();
        if (now - lastToneAtRef.current < 45) return;
        lastToneAtRef.current = now;

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!audioContextRef.current) {
                audioContextRef.current = new AudioCtx();
            }

            const ctx = audioContextRef.current;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            const stableLevel = typeof alertLevel === 'number' ? Math.max(0, Math.min(100, alertLevel)) : 30;
            const countryOffset = (countryName.length % 6) * 8;
            const frequency = 360 + stableLevel * 2.1 + countryOffset;

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

            gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.125);
        } catch {
            // Ignore audio errors so map interactions remain smooth.
        }
    };

    const alertLookup = useMemo(() => {
        const byName = new Map();
        const byIso = new Map();

        (alertData || []).forEach((item) => {
            if (item?.country) byName.set(normalizeCountry(item.country), item);
            if (item?.iso_code) byIso.set(item.iso_code.toUpperCase(), item);
        });

        return { byName, byIso };
    }, [alertData]);

    // The selection may already be a code (map click) or a name (sidebar);
    // the watch toggle keys on the code either way.
    const selectedIso = useMemo(() => {
        if (!selectedCountry) return '';
        if (selectedCountry.length === 2) return selectedCountry.toUpperCase();
        const hit = (alertData || []).find(
            (r) => normalizeCountry(r.country) === normalizeCountry(selectedCountry)
        );
        return hit?.iso_code || '';
    }, [alertData, selectedCountry]);

    const TOOLTIP_WIDTH = 200;
    const TOOLTIP_HEIGHT = 78;
    const TOOLTIP_GAP = 12;

    const getTooltipPosition = (clientX, clientY) => {
        const rect = mapContainerRef.current?.getBoundingClientRect();
        if (!rect) return { x: TOOLTIP_GAP, y: TOOLTIP_GAP };

        const localX = clientX - rect.left;
        const localY = clientY - rect.top;
        const maxX = rect.width - TOOLTIP_WIDTH - 8;
        const maxY = rect.height - TOOLTIP_HEIGHT - 8;
        const safeX = Math.max(8, Math.min(localX + TOOLTIP_GAP, maxX));
        const safeY = Math.max(8, Math.min(localY - TOOLTIP_HEIGHT - TOOLTIP_GAP, maxY));
        return { x: safeX, y: safeY };
    };

    return (
        <div className="glass rounded-[2.5rem] p-5 lg:p-6 relative overflow-hidden animate-fade-in-up">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.12),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.12),transparent_50%)]" />
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-5 gap-4">
                    <h2 className="text-base font-bold text-white uppercase tracking-widest">Intelligence Alert Map</h2>
                    {selectedCountry ? (
                        <button
                            type="button"
                            onClick={() => onCountrySelect('')}
                            className="text-[10px] font-bold tracking-widest uppercase text-slate-400 hover:text-cyan-400 transition-colors shrink-0"
                        >
                            Clear Selection
                        </button>
                    ) : (
                        // Nothing on the map says it is clickable until something
                        // is selected, so the affordance is stated outright.
                        <span className="text-[10px] font-bold tracking-widest uppercase text-slate-600 shrink-0 hidden sm:block">
                            Select a zone for its dossier
                        </span>
                    )}
                </div>

                <div ref={mapContainerRef} className={`relative ${heightClass}`}>
                    <ComposableMap
                        projectionConfig={{ scale: 205 }}
                        className="w-full h-full"
                        style={{ width: '100%', height: '100%' }}
                    >
                        <Geographies geography={geoUrl}>
                            {({ geographies }) =>
                                geographies.map((geo) => {
                                    const geoName = getGeoName(geo.properties);
                                    const normalizedName = normalizeCountry(geoName);
                                    // Resolve by ISO code first: the TopoJSON carries a numeric
                                    // ISO id, which is exact, unlike matching display names.
                                    const isoCode = geoToAlpha2(geo);
                                    const alertRecord =
                                        (isoCode && alertLookup.byIso.get(isoCode)) ||
                                        alertLookup.byName.get(normalizedName) ||
                                        null;

                                    const alertLevel = alertRecord?.alert_level;
                                    const displayName = alertRecord?.country || geoName;
                                    const isSelected = matchesCountry(selectedCountry, {
                                        name: displayName,
                                        iso: isoCode || alertRecord?.iso_code,
                                    });

                                    // Emit the ISO code when we have one. The TopoJSON label
                                    // ("Dem. Rep. Congo", "Bosnia and Herz.") is not a name the
                                    // backend can match, so clicking such a country used to
                                    // filter the feed to nothing and leave the live player
                                    // unable to find its broadcaster.
                                    const selectionValue = isoCode || displayName;

                                    return (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            onClick={() => onCountrySelect(isSelected ? '' : selectionValue)}
                                            onMouseEnter={(event) => {
                                                const pos = getTooltipPosition(event.clientX, event.clientY);
                                                setTooltip({
                                                    x: pos.x,
                                                    y: pos.y,
                                                    countryName: displayName,
                                                    alertLevel,
                                                    totalArticles: alertRecord?.total_articles,
                                                });

                                                if (lastHoveredCountryRef.current !== displayName) {
                                                    playHoverTone(displayName, alertLevel);
                                                    lastHoveredCountryRef.current = displayName;
                                                }
                                            }}
                                            onMouseMove={(event) => {
                                                setTooltip((prev) => {
                                                    if (!prev) return prev;
                                                    const pos = getTooltipPosition(event.clientX, event.clientY);
                                                    return { ...prev, x: pos.x, y: pos.y };
                                                });
                                            }}
                                            onMouseLeave={() => setTooltip(null)}
                                            style={{
                                                default: {
                                                    fill: isSelected ? '#3b82f6' : getAlertColorByLevel(alertLevel),
                                                    stroke: '#0f172a',
                                                    strokeWidth: isSelected ? 1.2 : 0.6,
                                                    outline: 'none',
                                                    transition: 'all 180ms ease-in-out',
                                                },
                                                hover: {
                                                    fill: isSelected ? '#60a5fa' : '#22d3ee',
                                                    stroke: '#38bdf8',
                                                    strokeWidth: 1,
                                                    outline: 'none',
                                                    filter: 'drop-shadow(0 0 8px rgba(34, 211, 238, 0.5))',
                                                    cursor: 'pointer',
                                                },
                                                pressed: {
                                                    fill: '#0ea5e9',
                                                    outline: 'none',
                                                },
                                            }}
                                        />
                                    );
                                })
                            }
                        </Geographies>
                    </ComposableMap>

                    {tooltip && (
                        <div
                            className="absolute z-50 px-3 py-2 rounded-xl border border-cyan-500/30 bg-slate-950/95 backdrop-blur-md pointer-events-none shadow-xl shadow-cyan-500/20"
                            style={{ left: tooltip.x, top: tooltip.y, width: `${TOOLTIP_WIDTH}px` }}
                        >
                            <p className="text-xs font-bold text-white">{tooltip.countryName}</p>
                            <p className="text-[11px] text-slate-300">
                                Alert Level:{' '}
                                <span className="font-semibold text-cyan-300">
                                    {typeof tooltip.alertLevel === 'number' ? `${tooltip.alertLevel.toFixed(1)}%` : 'No data'}
                                </span>
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">
                                {tooltip.totalArticles ? `${tooltip.totalArticles} reports` : 'No reports yet'}
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#10b981]" /> STABLE</span>
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> ELEVATED</span>
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#f43f5e]" /> CRITICAL</span>
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#1f2937]" /> NO DATA</span>
                    <span className="text-slate-400">Node Selected: {selectedLabel || selectedCountry || 'None'}</span>
                    {selectedCountry && onToggleWatch && (
                        <button
                            onClick={() => onToggleWatch(selectedIso)}
                            className={`flex items-center gap-1.5 transition-colors ${
                                isWatched?.(selectedIso) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'
                            }`}
                            title={isWatched?.(selectedIso) ? 'Remove from watchlist' : 'Add to watchlist'}
                        >
                            <Star size={11} fill={isWatched?.(selectedIso) ? 'currentColor' : 'none'} />
                            {isWatched?.(selectedIso) ? 'Watching' : 'Watch'}
                        </button>
                    )}
                </div>

                {timeline}
            </div>
        </div>
    );
};

export default MapChart;
