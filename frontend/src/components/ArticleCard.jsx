import { useState } from 'react';
import { AlertCircle, AlertTriangle, ShieldCheck, ExternalLink, Globe, Clock, Layers } from 'lucide-react';
import { getFlagEmoji } from '../utils/country';
import { timeAgo } from '../utils/time';

const alertConfig = {
    high: {
        icon: AlertCircle,
        color: 'text-risk-high',
        bg: 'bg-risk-high/10',
        border: 'border-risk-high/30',
        label: 'CRITICAL',
        gradient: 'from-risk-high to-risk-high',
    },
    medium: {
        icon: AlertTriangle,
        color: 'text-risk-medium',
        bg: 'bg-risk-medium/10',
        border: 'border-risk-medium/30',
        label: 'ELEVATED',
        gradient: 'from-risk-medium to-risk-medium',
    },
    low: {
        icon: ShieldCheck,
        color: 'text-risk-low',
        bg: 'bg-risk-low',
        border: 'border-risk-low/30',
        label: 'STABLE',
        gradient: 'from-risk-low to-risk-low',
    },
};

const EVENT_LABELS = {
    conflict: 'Conflict',
    security: 'Security',
    diplomacy: 'Diplomacy',
    economy: 'Economy',
    politics: 'Politics',
    disaster: 'Disasters',
    humanitarian: 'Humanitarian',
    other: 'Unclassified',
};

const ArticleCard = ({ article, index }) => {
    const {
        title,
        description,
        url,
        image_url,
        published_at,
        source,
        country,
        country_iso_code,
        geo_risk_score,
        geo_risk_level,
        event_type,
        duplicate_count = 0,
    } = article;

    // Most feeds publish lead artwork, but Google News publishes none, so a
    // large share of articles have no image at all. The band is therefore
    // rendered only when one exists — a grid of identical placeholders reads
    // worse than a clean text card. A URL that fails to load (expired asset,
    // hotlink block) collapses the band the same way.
    const [imageFailed, setImageFailed] = useState(false);
    const showImage = Boolean(image_url) && !imageFailed;

    const sourceName = source?.name || 'Unknown';
    const countryName = country || 'Unattributed';
    const isoCode = country_iso_code || 'Global';

    const age = timeAgo(published_at);

    // Driven by the risk engine; the card previously showed the legacy
    // sentiment score, which is only a rescaled alias of this value.
    const alert = alertConfig[geo_risk_level] || alertConfig.low;
    const AlertIcon = alert.icon;
    const riskScore = typeof geo_risk_score === 'number' ? geo_risk_score : null;

    return (
        <div
            className="group glass-card rounded-2xl overflow-hidden flex flex-col h-full relative transition-all duration-500 hover:shadow-2xl hover:shadow-transparent hover:-translate-y-1 animate-fade-in-up"
            style={{ animationDelay: `${index * 50}ms` }}
        >
            {/* Alert Status Bar */}
            <div className={`h-1 w-full bg-gradient-to-r ${alert.gradient}`} />

            {/* Lead image */}
            {showImage && (
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface shrink-0">
                    <img
                        src={image_url}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                        loading="lazy"
                        decoding="async"
                        // Several news CDNs reject cross-origin hotlinks by Referer;
                        // sending none is accepted more widely than sending ours.
                        referrerPolicy="no-referrer"
                        onError={() => setImageFailed(true)}
                    />
                    {/* Keeps the card body reading as one surface rather than a
                        photo with a panel bolted underneath. */}
                    <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0b1220] to-transparent pointer-events-none" />
                </div>
            )}

            <div className="p-6 flex flex-col h-full flex-grow">
                {/* Meta Header */}
                <div className="flex items-center justify-between mb-4 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1 rounded-lg bg-surface-sunken border border-rule group-hover:border-accent transition-colors">
                            <span className="text-lg leading-none" title={countryName}>{getFlagEmoji(isoCode)}</span>
                        </div>
                        <span
                            className="text-[10px] font-bold text-muted uppercase tracking-widest truncate max-w-[120px]"
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
                    <h3 className="text-base font-bold text-ink mb-2.5 line-clamp-2 leading-snug group-hover:text-accent transition-colors duration-300 decoration-cyan-500/30 decoration-2 underline-offset-4 group-hover:underline">
                        {title}
                    </h3>
                    <p className="text-body text-xs leading-relaxed line-clamp-3 mb-4 font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                        {description || 'Intelligence bulletin summary currently pending analysis.'}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                        {event_type && (
                            <span className="inline-block px-2 py-0.5 rounded-xl bg-surface-sunken border border-rule text-[9px] font-bold uppercase tracking-widest text-body">
                                {EVENT_LABELS[event_type] || event_type}
                            </span>
                        )}
                        {/* The same wire story reaches the pipeline once per outlet.
                            Only the canonical copy is shown; this says how many
                            others carried it rather than repeating the card. */}
                        {duplicate_count > 0 && (
                            <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl bg-accent-soft border border-accent/50 text-[9px] font-bold uppercase tracking-widest text-accent"
                                title={`Also reported by ${duplicate_count} other outlet${duplicate_count === 1 ? '' : 's'}`}
                            >
                                <Layers size={9} />
                                +{duplicate_count} outlets
                            </span>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-auto pt-5 border-t border-rule flex items-center justify-between">
                    <div className="flex items-center gap-4 text-[10px] font-bold text-muted tracking-wider">
                        <div className="flex items-center gap-1.5">
                            <Clock size={12} className="text-faint" />
                            <span>{age}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title={countryName}>
                            <Globe size={12} className="text-faint" />
                            <span className="uppercase">{isoCode}</span>
                        </div>
                    </div>

                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-xl bg-surface-sunken border border-rule text-accent hover:bg-accent-soft hover:border-accent hover:scale-110 active:scale-95 transition-all"
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
