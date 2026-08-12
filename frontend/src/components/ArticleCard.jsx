import React from 'react';
import { AlertCircle, AlertTriangle, ShieldCheck, ExternalLink, Globe, Clock } from 'lucide-react';
import { getFlagEmoji } from '../utils/country';

const alertConfig = {
    high: {
        icon: AlertCircle,
        color: 'text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
        label: 'CRITICAL',
        gradient: 'from-rose-500 to-rose-600',
    },
    medium: {
        icon: AlertTriangle,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        label: 'ELEVATED',
        gradient: 'from-amber-500 to-amber-600',
    },
    low: {
        icon: ShieldCheck,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        label: 'STABLE',
        gradient: 'from-emerald-500 to-emerald-600',
    },
};

const EVENT_LABELS = {
    military: 'Military',
    diplomatic: 'Diplomatic',
    economic: 'Economic',
    political: 'Political',
    hazard: 'Hazard',
    other: 'Unclassified',
};

const ArticleCard = ({ article, index }) => {
    const {
        title,
        description,
        url,
        published_at,
        source,
        country,
        country_iso_code,
        geo_risk_score,
        geo_risk_level,
        event_type,
    } = article;

    const sourceName = source?.name || 'Unknown';
    const countryName = country || 'Unattributed';
    const isoCode = country_iso_code || 'Global';

    const timeAgo = (() => {
        const publishedMs = new Date(published_at).getTime();
        if (Number.isNaN(publishedMs)) return 'Unknown';
        const diff = Date.now() - publishedMs;
        if (diff < 0) return 'Just now';
        const hrs = Math.floor(diff / (1000 * 60 * 60));
        if (hrs < 1) return 'Just now';
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    })();

    // Driven by the risk engine; the card previously showed the legacy
    // sentiment score, which is only a rescaled alias of this value.
    const alert = alertConfig[geo_risk_level] || alertConfig.low;
    const AlertIcon = alert.icon;
    const riskScore = typeof geo_risk_score === 'number' ? geo_risk_score : null;

    return (
        <div
            className="group glass-card rounded-3xl overflow-hidden flex flex-col h-full relative transition-all duration-500 hover:shadow-2xl hover:shadow-cyan-500/10 hover:-translate-y-1 animate-fade-in-up"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            {/* Alert Status Bar */}
            <div className={`h-1 w-full bg-gradient-to-r ${alert.gradient}`} />

            <div className="p-6 flex flex-col h-full flex-grow">
                {/* Meta Header */}
                <div className="flex items-center justify-between mb-4 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1 rounded-lg bg-white/5 border border-white/10 group-hover:border-cyan-500/30 transition-colors">
                            <span className="text-lg leading-none" title={countryName}>{getFlagEmoji(isoCode)}</span>
                        </div>
                        <span
                            className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate max-w-[120px]"
                            title={sourceName}
                        >
                            {sourceName}
                        </span>
                    </div>

                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 shrink-0 ${alert.bg} ${alert.color} border ${alert.border}`}>
                        <AlertIcon size={12} />
                        <span>{alert.label}</span>
                        {riskScore !== null && (
                            <span className="ml-1 opacity-70 border-l border-current pl-1.5 tabular-nums">
                                {riskScore.toFixed(0)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-grow">
                    <h3 className="text-base font-bold text-white mb-2.5 line-clamp-2 leading-snug group-hover:text-cyan-400 transition-colors duration-300 decoration-cyan-500/30 decoration-2 underline-offset-4 group-hover:underline">
                        {title}
                    </h3>
                    <p className="text-slate-400 text-xs leading-relaxed line-clamp-3 mb-4 font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                        {description || 'Intelligence bulletin summary currently pending analysis.'}
                    </p>
                    {event_type && (
                        <span className="inline-block px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                            {EVENT_LABELS[event_type] || event_type}
                        </span>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-auto pt-5 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 tracking-wider">
                        <div className="flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-600" />
                            <span>{timeAgo}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title={countryName}>
                            <Globe size={12} className="text-slate-600" />
                            <span className="uppercase">{isoCode}</span>
                        </div>
                    </div>

                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-white/5 border border-white/10 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/30 hover:scale-110 active:scale-95 transition-all"
                        title="View Full Intel Report"
                    >
                        <ExternalLink size={14} />
                    </a>
                </div>
            </div>
        </div>
    );
};

export default ArticleCard;
