import React from 'react';
import { AlertCircle, AlertTriangle, ShieldCheck, ExternalLink, Globe, Clock } from 'lucide-react';

const riskConfig = {
    high: {
        icon: AlertCircle,
        color: 'text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
        label: 'High Risk',
        gradient: 'from-rose-500 to-rose-600',
    },
    medium: {
        icon: AlertTriangle,
        color: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        label: 'Medium Risk',
        gradient: 'from-amber-500 to-amber-600',
    },
    low: {
        icon: ShieldCheck,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        label: 'Low Risk',
        gradient: 'from-emerald-500 to-emerald-600',
    },
};

const getFlagEmoji = (countryCode) => {
    if (!countryCode || typeof countryCode !== 'string' || countryCode === 'Global') return '🌐';
    const code = countryCode.trim().toUpperCase();
    if (code.length !== 2) return '🌐';
    try {
        return String.fromCodePoint(...code.split('').map(char => 127397 + char.charCodeAt()));
    } catch (e) {
        return '🌐';
    }
};

const ArticleCard = ({ article, index }) => {
    const { title, description, url, published_at, source, sentiment_score, sentiment_label } = article;
    const sourceName = (source?.name || 'Unknown').replace(/\s\[[A-Z]{2}\]$/, '');
    const countryName = source?.country?.name || 'Global';
    const isoCode = source?.country?.iso_code || 'Global';

    const timeAgo = (() => {
        const diff = Date.now() - new Date(published_at).getTime();
        const hrs = Math.floor(diff / (1000 * 60 * 60));
        if (hrs < 1) return 'Just now';
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    })();

    // Default to 'low' config if label doesn't match
    const risk = riskConfig[sentiment_label] || riskConfig.low;
    const RiskIcon = risk.icon;

    return (
        <div
            className="group glass-card rounded-3xl overflow-hidden flex flex-col h-full relative transition-all duration-500 hover:shadow-2xl hover:shadow-cyan-500/10 hover:-translate-y-1 animate-fade-in-up"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            {/* Risk Gradient Bar */}
            <div className={`h-1 w-full bg-gradient-to-r ${risk.gradient}`} />

            <div className="p-6 flex flex-col h-full flex-grow">
                {/* Meta Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1 rounded-lg bg-white/5 border border-white/10 group-hover:border-cyan-500/30 transition-colors">
                            <span className="text-lg leading-none" title={countryName}>{getFlagEmoji(isoCode)}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate max-w-[100px]">
                            {sourceName}
                        </span>
                    </div>

                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 ${risk.bg} ${risk.color} border ${risk.border}`}>
                        <RiskIcon size={12} />
                        <span>{risk.label.toUpperCase()}</span>
                        <span className="ml-1 opacity-70 border-l border-current pl-1.5">{Math.abs(sentiment_score || 0).toFixed(2)}</span>
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
                </div>

                {/* Footer */}
                <div className="mt-auto pt-5 border-t border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 tracking-wider">
                        <div className="flex items-center gap-1.5">
                            <Clock size={12} className="text-slate-600" />
                            <span>{timeAgo}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
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
