import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Clock } from 'lucide-react';
import { getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';
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

const RiskTag = ({ level, score, className = '' }) => {
    if (!level) return null;
    const color = getAlertColor(level);
    return (
        <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${className}`}
            style={{ color }}
        >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
            {ALERT_STATUS_LABEL[level] || 'Stable'}
            {typeof score === 'number' && <span className="opacity-60 tabular-nums">{score.toFixed(0)}</span>}
        </span>
    );
};

const Meta = ({ article, className = '' }) => (
    <div className={`flex items-center gap-2 text-[12px] text-slate-500 ${className}`}>
        <span className="font-semibold text-slate-400 truncate">{article.source?.name || 'Unknown'}</span>
        <span aria-hidden="true">·</span>
        <span className="flex items-center gap-1 shrink-0">
            <Clock size={11} />
            {timeAgo(article.published_at)}
        </span>
        {article.duplicate_count > 0 && (
            <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-cyan-400/80 shrink-0" title={`${article.duplicate_count} other outlets carried this`}>
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
    <article className="group relative rounded-3xl overflow-hidden border border-white/10 bg-slate-900/40">
        <Link to={`/story/${article.id}`} className="block">
            <div className="relative aspect-[16/9] md:aspect-[21/9] bg-slate-900">
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
                        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">
                            {article.country}
                        </span>
                    )}
                </div>
                <h2 className="font-serif text-2xl md:text-4xl lg:text-[2.75rem] font-bold text-white leading-[1.15] tracking-tight max-w-3xl group-hover:text-cyan-200 transition-colors">
                    {article.title}
                </h2>
                {article.description && (
                    <p className="mt-3 text-[15px] text-slate-300 leading-relaxed max-w-2xl line-clamp-2 hidden sm:block">
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
                <div className="relative w-28 sm:w-32 aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 shrink-0">
                    <Thumb src={article.image_url} className="absolute inset-0 w-full h-full object-cover" />
                </div>
            )}
            <div className="min-w-0 flex-grow">
                <RiskTag level={article.geo_risk_level} className="mb-1.5" />
                <h3 className="font-serif text-base sm:text-lg font-semibold text-white leading-snug line-clamp-3 group-hover:text-cyan-300 transition-colors">
                    {article.title}
                </h3>
                <Meta article={article} className="mt-2" />
            </div>
        </Link>
    </article>
);

/** The river: everything after the top of the page. */
export const StoryCard = ({ article }) => (
    <article className="group flex flex-col h-full rounded-2xl border border-white/10 bg-slate-900/30 overflow-hidden transition-colors hover:border-white/20">
        <Link to={`/story/${article.id}`} className="flex flex-col h-full">
            {article.image_url && (
                <div className="relative aspect-[16/9] bg-slate-900 shrink-0">
                    <Thumb
                        src={article.image_url}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                    />
                </div>
            )}
            <div className="p-5 flex flex-col flex-grow">
                <div className="flex items-center gap-2 mb-2">
                    <RiskTag level={article.geo_risk_level} score={article.geo_risk_score} />
                    {article.country && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 truncate">
                            {article.country}
                        </span>
                    )}
                </div>
                <h3 className="font-serif text-[17px] font-semibold text-white leading-snug line-clamp-3 group-hover:text-cyan-300 transition-colors">
                    {article.title}
                </h3>
                {article.description && (
                    <p className="mt-2 text-[13px] text-slate-400 leading-relaxed line-clamp-2">
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
                <h3 className="font-serif text-[15px] font-semibold text-white leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors">
                    {article.title}
                </h3>
                <Meta article={article} className="mt-1.5" />
            </div>
            {article.image_url && (
                <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                    <Thumb src={article.image_url} className="absolute inset-0 w-full h-full object-cover" />
                </div>
            )}
        </Link>
    </article>
);
