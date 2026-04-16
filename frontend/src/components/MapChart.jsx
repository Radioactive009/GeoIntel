import React, { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import worldTopoJson from 'world-atlas/countries-110m.json';

const geoUrl = worldTopoJson;

const COUNTRY_ALIASES = {
    'united states of america': 'united states',
    usa: 'united states',
    'russian federation': 'russia',
    'iran (islamic republic of)': 'iran',
};

const normalizeCountry = (value) => {
    if (!value) return '';
    const normalized = value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[().,]/g, '')
        .replace(/\s+/g, ' ');
    return COUNTRY_ALIASES[normalized] || normalized;
};

const getRiskColor = (risk) => {
    if (typeof risk !== 'number') return '#1f2937';
    if (risk > 70) return '#ef4444';
    if (risk > 40) return '#f59e0b';
    return '#22c55e';
};

const getDisplayCountryName = (geoProperties) =>
    geoProperties?.NAME || geoProperties?.ADMIN || geoProperties?.name || 'Unknown';

const MapChart = ({ riskData, selectedCountry, onCountrySelect }) => {
    const [tooltip, setTooltip] = useState(null);

    const riskLookup = useMemo(() => {
        const byName = new Map();
        const byIso = new Map();

        riskData.forEach((item) => {
            if (item?.country) byName.set(normalizeCountry(item.country), item);
            if (item?.iso_code) byIso.set(item.iso_code.toUpperCase(), item);
        });

        return { byName, byIso };
    }, [riskData]);

    const selectedNormalized = normalizeCountry(selectedCountry);

    return (
        <div className="glass rounded-[2.5rem] p-5 lg:p-6 relative overflow-hidden animate-fade-in-up">
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.12),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.12),transparent_50%)]" />
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base font-bold text-white uppercase tracking-widest">Global Risk Map</h2>
                    <button
                        type="button"
                        onClick={() => onCountrySelect('')}
                        className="text-[10px] font-bold tracking-widest uppercase text-slate-400 hover:text-cyan-400 transition-colors"
                    >
                        Clear Selection
                    </button>
                </div>

                <div className="relative h-[360px] md:h-[520px] lg:h-[640px]">
                    <ComposableMap
                        projectionConfig={{ scale: 220 }}
                        className="w-full h-full"
                        style={{ width: '100%', height: '100%' }}
                    >
                        <Geographies geography={geoUrl}>
                            {({ geographies }) =>
                                geographies.map((geo) => {
                                    const countryName = getDisplayCountryName(geo.properties);
                                    const normalizedName = normalizeCountry(countryName);
                                    const isoCode =
                                        geo.properties?.ISO_A2 ||
                                        geo.properties?.iso_a2 ||
                                        geo.properties?.ISO2 ||
                                        '';
                                    const riskRecord =
                                        riskLookup.byName.get(normalizedName) ||
                                        riskLookup.byIso.get(isoCode.toUpperCase()) ||
                                        null;
                                    const riskScore = riskRecord?.risk_score;
                                    const isSelected = selectedNormalized === normalizedName;

                                    const selectedCountryName = riskRecord?.country || countryName;

                                    return (
                                        <Geography
                                            key={geo.rsmKey}
                                            geography={geo}
                                            onClick={() => onCountrySelect(selectedCountryName)}
                                            onMouseEnter={(event) => {
                                                const rect = event.currentTarget.getBoundingClientRect();
                                                setTooltip({
                                                    x: rect.x + rect.width / 2,
                                                    y: rect.y,
                                                    countryName,
                                                    riskScore,
                                                });
                                            }}
                                            onMouseLeave={() => setTooltip(null)}
                                            style={{
                                                default: {
                                                    fill: isSelected ? '#3b82f6' : getRiskColor(riskScore),
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
                            className="fixed z-50 px-3 py-2 rounded-xl border border-cyan-500/30 bg-slate-950/95 backdrop-blur-md pointer-events-none shadow-xl shadow-cyan-500/20"
                            style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
                        >
                            <p className="text-xs font-bold text-white">{tooltip.countryName}</p>
                            <p className="text-[11px] text-slate-300">
                                Risk:{' '}
                                <span className="font-semibold text-cyan-300">
                                    {typeof tooltip.riskScore === 'number' ? `${tooltip.riskScore.toFixed(1)}%` : 'No data'}
                                </span>
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" /> Low</span>
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]" /> Medium</span>
                    <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" /> High</span>
                    <span className="text-slate-400">Selected country: {selectedCountry || 'None'}</span>
                </div>
            </div>
        </div>
    );
};

export default MapChart;
