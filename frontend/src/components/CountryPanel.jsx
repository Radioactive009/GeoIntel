import React from 'react';
import { X, Newspaper, ArrowDown, Loader2, Radio } from 'lucide-react';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';
import { timeAgo } from '../utils/time';
import Sparkline from './Sparkline';

/**
 * Country dossier.
 *
 * Opens beside the map once a country is selected, so the map can occupy the
 * full width until there is something to say. Everything here is already
 * loaded or cheap to fetch — the alert record comes from the scan the
 * dashboard has in hand, and only the headline list is requested per country.
 */

const ArticleRow = ({ article }) => {
    const dot = getAlertColor(article.geo_risk_level);

    return (
        <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex gap-3 p-2.5 rounded-2xl transition-colors hover:bg-white/[0.06]"
        >
            {article.image_url ? (
                <img
                    src={article.image_url}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 rounded-xl object-cover shrink-0 border border-white/10"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
            ) : (
                <div className="w-14 h-14 rounded-xl shrink-0 bg-slate-800/60 border border-white/5 grid place-items-center">
                    <Newspaper size={16} className="text-slate-600" />
                </div>
            )}

            <div className="min-w-0 flex-grow">
                <p className="text-xs font-bold text-white leading-snug line-clamp-2 group-hover:text-cyan-400 transition-colors">
                    {article.title}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />
                    <span className="text-[10px] font-medium text-slate-500 truncate">
                        {article.source?.name || 'Unknown'} · {timeAgo(article.published_at)}
                    </span>
                </div>
            </div>
        </a>
    );
};

const CountryPanel = ({
    name,
    iso,
    record,          // alert-scan row, null when the country has no articles
    articles = [],
    loading = false,
    trend,
    liveChannel,
    watchToggle,
    onClear,
    onViewAll,
}) => {
    const level = record?.alert_level ?? 0;
    const status = record?.alert_status || 'low';
    const color = getAlertColor(status);
    const hasData = Boolean(record);

    // Net movement across the window, so the chart carries a number too.
    const trendLabel = (() => {
        const scores = (trend || []).map((p) => p?.score).filter((s) => typeof s === 'number');
        if (scores.length < 2) return '';
        const delta = scores[scores.length - 1] - scores[0];
        if (Math.abs(delta) < 0.05) return 'flat';
        return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} over window`;
    })();

    return (
        <aside className="glass rounded-[2.5rem] p-6 lg:p-7 relative overflow-hidden animate-slide-in-left">
            {/* Risk-tinted wash, so the panel reads as this country's status
                before a single number is parsed. */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: `radial-gradient(circle at 12% 0%, ${color}26, transparent 58%)` }}
            />

            <div className="relative z-10 space-y-6">
                {/* Identity */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <span className="text-4xl leading-none shrink-0">{getFlagEmoji(iso)}</span>
                        <div className="min-w-0">
                            <h2 className="text-xl font-extrabold text-white tracking-tight truncate">{name}</h2>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 truncate">
                                {[record?.region, iso].filter(Boolean).join(' · ') || 'Unlisted zone'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClear}
                        aria-label="Clear country selection"
                        className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-colors shrink-0 active:scale-90"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Alert readout */}
                <div className="rounded-3xl bg-slate-900/50 border border-white/5 p-5 space-y-4">
                    <div className="flex items-end justify-between gap-3">
                        <div>
                            <p className="text-[9px] font-extrabold uppercase tracking-[0.25em] text-slate-500 mb-1">
                                Alert Level
                            </p>
                            <p className="text-4xl font-black tabular-nums leading-none" style={{ color }}>
                                {level.toFixed(1)}
                                <span className="text-lg font-bold opacity-60">%</span>
                            </p>
                        </div>
                        <span
                            className="px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-widest border"
                            style={{ color, borderColor: `${color}55`, background: `${color}1a` }}
                        >
                            {ALERT_STATUS_LABEL[status] || 'STABLE'}
                        </span>
                    </div>

                    <div className="h-1.5 rounded-full bg-slate-800/70 overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${Math.min(100, Math.max(0, level))}%`, background: color }}
                        />
                    </div>

                    <div className="flex gap-5">
                        <div>
                            <p className="text-sm font-bold text-white tabular-nums leading-none">
                                {record?.total_articles ?? 0}
                            </p>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1">Reports</p>
                        </div>
                        <div>
                            <p className="text-sm font-bold tabular-nums leading-none" style={{ color: getAlertColor('high') }}>
                                {record?.critical_alerts ?? 0}
                            </p>
                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1">Critical</p>
                        </div>
                        {watchToggle}
                    </div>

                    {/* Full-width trajectory rather than the 78px stub that used to
                        sit beside the counters — /trends returns the whole series
                        per country and there is room for it here. */}
                    <div className="pt-1">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                Risk Trajectory
                            </span>
                            {trendLabel && (
                                <span className="text-[9px] font-bold text-slate-600 tabular-nums">{trendLabel}</span>
                            )}
                        </div>
                        <Sparkline points={trend} color={color} width={300} height={56} strokeWidth={2} />
                    </div>
                </div>

                {liveChannel && (
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl bg-rose-500/[0.08] border border-rose-500/20">
                        <Radio size={13} className="text-rose-400 animate-pulse shrink-0" />
                        <span className="text-[10px] font-bold text-rose-300 uppercase tracking-widest shrink-0">Live</span>
                        <span className="text-[11px] text-slate-400 font-medium truncate">{liveChannel.name}</span>
                    </div>
                )}

                {/* Headlines */}
                <div>
                    <div className="flex items-center justify-between mb-2 px-1">
                        <h3 className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-slate-400">
                            Latest Intelligence
                        </h3>
                        {hasData && (
                            <span className="text-[10px] font-bold text-slate-600 tabular-nums">
                                {record.total_articles}
                            </span>
                        )}
                    </div>

                    {loading ? (
                        <div className="py-10 flex items-center justify-center">
                            <Loader2 size={20} className="text-cyan-400 animate-spin" />
                        </div>
                    ) : articles.length ? (
                        <div className="space-y-0.5 -mx-1">
                            {articles.map((article) => (
                                <ArticleRow key={article.id} article={article} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-8 px-4 text-center rounded-2xl bg-slate-900/40 border border-white/5">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-600">
                                No reports for this zone
                            </p>
                            <p className="text-[11px] text-slate-600 font-medium mt-2 leading-relaxed">
                                The catalog rotates through all 249 countries — coverage appears once
                                an ingest cycle reaches this one.
                            </p>
                        </div>
                    )}
                </div>

                {articles.length > 0 && (
                    <button
                        onClick={onViewAll}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/[0.04] border border-white/5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all active:scale-[0.98]"
                    >
                        View all reports
                        <ArrowDown size={13} />
                    </button>
                )}
            </div>
        </aside>
    );
};

export default CountryPanel;
