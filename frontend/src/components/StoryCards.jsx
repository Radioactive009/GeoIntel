import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Clock, AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { getAlertColor } from '../utils/country';
import { timeAgo } from '../utils/time';

/**
 * Editorial story presentation.
 *
 * A news front page carries hierarchy: one lead, a few secondary stories,
 * then the river. A uniform grid of identically-weighted cards is a dashboard
 * pattern, and reads as one.
 *
 * All three variants link inward to /story/:id rather than straight out to
 * the publisher, so the reader stays on the site and can see who else carried
 * the story.
 */

const RISK_STYLE = {
    high: { icon: AlertCircle, label: 'CRITICAL' },
    medium: { icon: AlertTriangle, label: 'ELEVATED' },
    low: { icon: ShieldCheck, label: 'STABLE' },
};

/**
 * Risk badge — the level and its 0-100 score.
 *
 * Tone is not shown here. It drives the mood switch on the front page, where
 * the reader is choosing what to read; repeating it on every card competed
 * with the risk reading for the same slot and said the same thing twice.
 */
const RiskTag = ({ level, score, className = '' }) => {
    const style = RISK_STYLE[level];
    if (!style) return null;
    const color = getAlertColor(level);
    const Icon = style.icon;

    return (
        <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wider ${className}`}
            style={{ color, borderColor: `${color}40`, background: `${color}14` }}
        >
            <Icon size={11} />
            {style.label}
            {typeof score === 'number' && (
                <span className="pl-1.5 ml-0.5 border-l border-current/30 opacity-80 tabular-nums">
                    {score.toFixed(0)}
                </span>
            )}
        </span>
    );
};

const Meta = ({ article, className = '' }) => (
    <div className={`flex items-center gap-2 text-[12px] text-muted ${className}`}>
        <span className="font-semibold text-body truncate">{article.source?.name || 'Unknown'}</span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1 shrink-0">
            <Clock size={11} />
            {timeAgo(article.published_at)}
        </span>
        {article.duplicate_count > 0 && (
            <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-accent/80 shrink-0" title={`${article.duplicate_count} other outlets carried this`}>
                    <Layers size={11} />
                    +{article.duplicate_count}
                </span>
            </>
        )}
    </div>
);

const Thumb = ({ src, className, sizes }) => {
    const [failed, setFailed] = useState(false);
    if (!src || failed) return null;
    return (
        <img
            src={src}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            sizes={sizes}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className={className}
        />
    );
};

/** The front page's single most prominent story. */
export const LeadStory = ({ article }) => (
    <article className="group relative rounded-2xl overflow-hidden border border-rule bg-surface">
        <Link to={`/story/${article.id}`} className="block">
            <div className="relative aspect-[16/9] md:aspect-[21/9] bg-surface">
                <Thumb
                    src={article.image_url}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                />
                {/* Legibility floor for the overlaid headline, independent of
                    how bright the photograph happens to be. */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/70 to-transparent" />
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 lg:p-10">
                <div className="flex items-center gap-3 mb-3">
                    <RiskTag level={article.geo_risk_level} score={article.geo_risk_score} />
                    {article.country && (
                        <span className="text-[11px] font-bold uppercase tracking-widest text-body">
                            {article.country}
                        </span>
                    )}
                </div>
                <h2 className="font-serif text-2xl md:text-4xl lg:text-[2.75rem] font-bold text-ink leading-[1.15] tracking-tight max-w-3xl group-hover:text-accent transition-colors">
                    {article.title}
                </h2>
                {article.description && (
                    <p className="mt-3 text-[15px] text-body leading-relaxed max-w-2xl line-clamp-2 hidden sm:block">
                        {article.description}
                    </p>
                )}
                <Meta article={article} className="mt-4" />
            </div>
        </Link>
    </article>
);

/** Supporting stories beside the lead. */
export const SecondaryStory = ({ article }) => (
    <article className="group">
        <Link to={`/story/${article.id}`} className="flex gap-4">
            {article.image_url && (
                <div className="relative w-28 sm:w-32 aspect-[4/3] rounded-xl overflow-hidden bg-surface shrink-0">
                    <Thumb src={article.image_url} className="absolute inset-0 w-full h-full object-cover" />
                </div>
            )}
            <div className="min-w-0 flex-grow">
                <RiskTag level={article.geo_risk_level} className="mb-1.5" />
                <h3 className="font-serif text-base sm:text-lg font-semibold text-ink leading-snug line-clamp-3 group-hover:text-accent transition-colors">
                    {article.title}
                </h3>
                <Meta article={article} className="mt-2" />
            </div>
        </Link>
    </article>
);

/** The river: everything after the top of the page. */
export const StoryCard = ({ article }) => (
    <article className="group flex flex-col h-full rounded-2xl border border-rule bg-surface-sunken overflow-hidden transition-all duration-300 hover:bg-surface-sunken hover:border-rule-strong">
        <Link to={`/story/${article.id}`} className="flex flex-col h-full">
            {article.image_url && (
                <div className="relative aspect-[16/9] bg-surface shrink-0">
                    <Thumb
                        src={article.image_url}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                </div>
            )}
            <div className="p-5 flex flex-col flex-grow">
                <div className="flex items-center gap-2.5 mb-2.5">
                    <RiskTag level={article.geo_risk_level} score={article.geo_risk_score} />
                    {article.country && (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted truncate">
                            {article.country}
                        </span>
                    )}
                </div>
                <h3 className="font-serif text-[19px] font-semibold text-ink leading-[1.3] line-clamp-3 group-hover:text-accent transition-colors">
                    {article.title}
                </h3>
                {article.description && (
                    <p className="mt-2.5 text-[13.5px] text-body/90 leading-[1.6] line-clamp-2">
                        {article.description}
                    </p>
                )}
                <Meta article={article} className="mt-auto pt-4" />
            </div>
        </Link>
    </article>
);

/** Compact row for sidebars and related lists. */
export const StoryRow = ({ article }) => (
    <article className="group">
        <Link to={`/story/${article.id}`} className="flex gap-3 py-3">
            <div className="min-w-0 flex-grow">
                <h3 className="font-serif text-[15px] font-semibold text-ink leading-snug line-clamp-2 group-hover:text-accent transition-colors">
                    {article.title}
                </h3>
                <Meta article={article} className="mt-1.5" />
            </div>
            {article.image_url && (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-surface shrink-0">
                    <Thumb src={article.image_url} className="absolute inset-0 w-full h-full object-cover" />
                </div>
            )}
        </Link>
    </article>
);
