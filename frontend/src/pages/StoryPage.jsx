import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Clock, Globe, Layers } from 'lucide-react';
import { getArticle } from '../services/api';
import { getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';
import { timeAgo } from '../utils/time';
import { StoryRow } from '../components/StoryCards';
import { StoryRowSkeleton } from '../components/Skeleton';
import Seo from '../components/Seo';

const EVENT_LABELS = {
    conflict: 'Conflict', security: 'Security', diplomacy: 'Diplomacy',
    economy: 'Economy', politics: 'Politics', disaster: 'Disasters',
    humanitarian: 'Humanitarian', other: 'Unclassified',
};

/**
 * Story page.
 *
 * The dashboard sent every reader straight to the publisher. This keeps them
 * here long enough to see two things the pipeline already knows and never
 * showed: which other outlets carried the same story (the cluster), and what
 * else is happening in that country.
 *
 * It does not reproduce the article body — only the headline and the
 * publisher's own summary, with attribution and a prominent link out. The
 * full text belongs to whoever wrote it.
 */
const StoryPage = () => {
    const { id } = useParams();
    const [article, setArticle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setNotFound(false);
        window.scrollTo(0, 0);

        getArticle(id)
            .then((res) => { if (!cancelled) setArticle(res.data); })
            .catch((err) => {
                if (cancelled) return;
                if (err?.response?.status === 404) setNotFound(true);
                console.error(err);
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [id]);

    if (loading) {
        return (
            <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
                <div className="h-3 w-24 bg-white/[0.06] rounded animate-pulse" />
                <div className="h-10 w-full bg-white/[0.06] rounded animate-pulse" />
                <div className="h-10 w-2/3 bg-white/[0.06] rounded animate-pulse" />
                <div className="aspect-[16/9] bg-white/[0.06] rounded-2xl animate-pulse" />
            </div>
        );
    }

    if (notFound || !article) {
        return (
            <div className="max-w-2xl mx-auto px-6 py-24 text-center space-y-5">
                <Seo title="Story not found" noIndex />
                <h1 className="font-serif text-3xl font-bold text-white">Story not found</h1>
                <p className="text-slate-400">
                    This story may have passed out of the retention window.
                </p>
                <Link to="/" className="btn-primary inline-block">Back to the front page</Link>
            </div>
        );
    }

    const color = getAlertColor(article.geo_risk_level);
    const alsoReported = article.also_reported_by || [];
    const related = article.related || [];

    return (
        <article className="max-w-6xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title={article.title}
                description={article.description || `Coverage of ${article.country || 'this story'} on GeoIntel.`}
                image={article.image_url}
                type="article"
                path={`/story/${article.id}`}
                publishedAt={article.published_at}
                schema={{
                    '@context': 'https://schema.org',
                    '@type': 'NewsArticle',
                    headline: article.title,
                    datePublished: article.published_at,
                    image: article.image_url ? [article.image_url] : undefined,
                    publisher: { '@type': 'Organization', name: article.source?.name || 'Unknown' },
                    isBasedOn: article.url,
                    contentLocation: article.country
                        ? { '@type': 'Place', name: article.country }
                        : undefined,
                }}
            />

            <Link
                to="/"
                className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-400 hover:text-cyan-400 transition-colors mb-8"
            >
                <ArrowLeft size={14} /> Front page
            </Link>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                <div className="lg:col-span-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border"
                            style={{ color, borderColor: `${color}55`, background: `${color}1a` }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                            {ALERT_STATUS_LABEL[article.geo_risk_level] || 'Stable'}
                            {typeof article.geo_risk_score === 'number' && (
                                <span className="opacity-70 tabular-nums">{article.geo_risk_score.toFixed(0)}</span>
                            )}
                        </span>
                        {article.event_type && (
                            <Link
                                to={`/topic/${article.event_type}`}
                                className="text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-cyan-400 transition-colors"
                            >
                                {EVENT_LABELS[article.event_type] || article.event_type}
                            </Link>
                        )}
                    </div>

                    <h1 className="font-serif text-3xl md:text-4xl lg:text-[2.6rem] font-bold text-white leading-[1.15] tracking-tight">
                        {article.title}
                    </h1>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5 pb-6 border-b border-white/10 text-[13px] text-slate-400">
                        <span className="font-semibold text-slate-300">{article.source?.name || 'Unknown source'}</span>
                        <span className="flex items-center gap-1.5">
                            <Clock size={12} /> {timeAgo(article.published_at)}
                        </span>
                        {article.country_iso_code && (
                            <Link
                                to={`/country/${article.country_iso_code}`}
                                className="flex items-center gap-1.5 hover:text-cyan-400 transition-colors"
                            >
                                <Globe size={12} /> {article.country}
                            </Link>
                        )}
                        {article.country_secondary_iso_code && (
                            <Link
                                to={`/country/${article.country_secondary_iso_code}`}
                                className="hover:text-cyan-400 transition-colors"
                            >
                                {article.country_secondary}
                            </Link>
                        )}
                    </div>

                    {article.image_url && (
                        <figure className="mt-8">
                            <img
                                src={article.image_url}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="w-full rounded-2xl border border-white/10"
                            />
                            <figcaption className="mt-2 text-[11px] text-slate-600">
                                Image: {article.source?.name || 'source publication'}
                            </figcaption>
                        </figure>
                    )}

                    {article.description && (
                        <p className="mt-8 font-serif text-lg md:text-xl text-slate-200 leading-[1.7] max-w-prose">
                            {article.description}
                        </p>
                    )}

                    <div className="mt-8 p-6 rounded-2xl bg-slate-900/50 border border-white/10">
                        <p className="text-[13px] text-slate-400 leading-relaxed mb-4">
                            This is a summary. The full report is published by{' '}
                            <span className="font-semibold text-slate-300">{article.source?.name || 'the source'}</span>.
                        </p>
                        <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-primary inline-flex items-center gap-2"
                        >
                            Read the full report <ExternalLink size={14} />
                        </a>
                    </div>

                    {alsoReported.length > 0 && (
                        <section className="mt-12">
                            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                                <Layers size={13} /> Also reported by
                            </h2>
                            <p className="text-[13px] text-slate-500 mb-4">
                                {alsoReported.length} other outlet{alsoReported.length === 1 ? '' : 's'} carried this story.
                            </p>
                            <ul className="divide-y divide-white/5">
                                {alsoReported.map((other) => (
                                    <li key={other.id} className="py-3 flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold text-slate-300 truncate">
                                                {other.source?.name || 'Unknown'}
                                            </p>
                                            <p className="text-[12px] text-slate-500 truncate">{other.title}</p>
                                        </div>
                                        <a
                                            href={other.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`Read this story at ${other.source?.name || 'the publisher'}`}
                                            className="p-2 rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-white/5 transition-colors shrink-0"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>

                <aside className="lg:col-span-1">
                    <div className="lg:sticky lg:top-24">
                        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 pb-3 border-b border-white/10">
                            {article.country ? `More on ${article.country}` : 'More stories'}
                        </h2>
                        {related.length ? (
                            <div className="divide-y divide-white/5">
                                {related.map((row) => <StoryRow key={row.id} article={row} />)}
                            </div>
                        ) : (
                            <div className="pt-3">
                                <StoryRowSkeleton />
                                <p className="text-[13px] text-slate-600 mt-2">No other coverage yet.</p>
                            </div>
                        )}
                        {article.country_iso_code && (
                            <Link
                                to={`/country/${article.country_iso_code}`}
                                className="mt-4 inline-block text-[13px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                            >
                                All {article.country} coverage →
                            </Link>
                        )}
                    </div>
                </aside>
            </div>
        </article>
    );
};

export default StoryPage;
