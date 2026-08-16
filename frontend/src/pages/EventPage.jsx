import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Newspaper, TrendingUp, AlertCircle } from 'lucide-react';
import { getEvent } from '../services/api';
import { getAlertColor } from '../utils/country';
import { timeAgo } from '../utils/time';
import { StoryRow } from '../components/StoryCards';
import AskAbout from '../components/AskAbout';
import SaveStory from '../components/SaveStory';
import TermChips from '../components/TermChips';
import Seo from '../components/Seo';
import { FramingPanel, CoveragePanel } from '../components/EventAnalytics';

const FIGURE_LABELS = {
    deaths: 'Deaths reported', injured: 'Injured', missing: 'Missing',
    displaced: 'Displaced', rescued: 'Rescued',
};

const TOPIC_LABELS = {
    conflict: 'Conflict', security: 'Security', diplomacy: 'Diplomacy',
    economy: 'Economy', politics: 'Politics', disaster: 'Disasters',
    humanitarian: 'Humanitarian', other: 'Unclassified',
};

/**
 * One happening, assembled from every article about it.
 *
 * The unit here is the event, not the article: a single earthquake is 70
 * articles in the feed and one page here. What that makes visible is the
 * thing a feed cannot show — how the story developed, and how the figures
 * reported about it changed while it did.
 */

const FigureTimeline = ({ kind, points }) => {
    if (!points?.length) return null;
    const values = points.map((p) => p.value);
    const peak = Math.max(...values);

    return (
        <section className="mb-8">
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-body mb-1">
                <TrendingUp size={13} /> {FIGURE_LABELS[kind] || kind}
            </h3>
            <p className="text-[12px] text-faint mb-4">
                As reported over time. Outlets update at different moments, so a figure can
                appear to fall — that is a slower outlet, not a correction.
            </p>

            <ol className="relative border-l border-rule ml-2">
                {points.map((point, i) => (
                    <li key={`${point.t}-${i}`} className="ml-5 pb-5 last:pb-0 relative">
                        <span
                            className="absolute -left-[26px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-background"
                            style={{ background: i === points.length - 1 ? '#f43f5e' : '#475569' }}
                        />
                        <div className="flex items-baseline gap-3 flex-wrap">
                            <span className="font-display text-2xl font-black text-ink tabular-nums">
                                {point.value.toLocaleString()}
                            </span>
                            {/* Bar is relative to the peak, so the shape of the
                                escalation is legible without axes. */}
                            <div className="flex-grow min-w-[80px] max-w-[220px] h-1 rounded-full bg-surface-sunken overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-risk-high/10"
                                    style={{ width: `${(point.value / peak) * 100}%` }}
                                />
                            </div>
                        </div>
                        <p className="text-[12px] text-muted mt-1">
                            {point.source || 'Unknown'} ·{' '}
                            {new Date(point.t).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                        </p>
                        <p className="text-[12px] text-faint line-clamp-1">{point.title}</p>
                    </li>
                ))}
            </ol>
        </section>
    );
};

const EventPage = () => {
    const { key } = useParams();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setMissing(false);
        window.scrollTo(0, 0);
        getEvent(key)
            .then((res) => { if (!cancelled) setEvent(res.data); })
            .catch((err) => {
                if (cancelled) return;
                if (err?.response?.status === 404) setMissing(true);
                console.error(err);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [key]);

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto px-6 py-12 space-y-5">
                <div className="h-3 w-28 bg-surface-sunken rounded animate-pulse" />
                <div className="h-10 w-full bg-surface-sunken rounded animate-pulse" />
                <div className="h-40 w-full bg-surface-sunken rounded-2xl animate-pulse" />
            </div>
        );
    }

    if (missing || !event) {
        return (
            <div className="max-w-2xl mx-auto px-6 py-24 text-center space-y-5">
                <Seo title="Event not found" noIndex />
                <h1 className="font-serif text-3xl font-bold text-ink">Event not found</h1>
                <Link to="/events" className="btn-primary inline-block">All events</Link>
            </div>
        );
    }

    const color = getAlertColor(event.risk >= 70 ? 'high' : event.risk >= 40 ? 'medium' : 'low');
    const span = Math.max(
        1,
        Math.round((new Date(event.last_seen) - new Date(event.first_seen)) / 3600000)
    );

    return (
        <div className="max-w-4xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title={event.title}
                description={`${event.article_count} reports from ${event.outlet_count} outlets.`}
                image={event.image_url}
                type="article"
                path={`/event/${event.event_key}`}
                publishedAt={event.first_seen}
            />

            <Link to="/events" className="inline-flex items-center gap-2 text-[13px] font-semibold text-body hover:text-accent transition-colors mb-8">
                <ArrowLeft size={14} /> All events
            </Link>

            <div className="flex flex-wrap items-center gap-3 mb-4">
                {event.topic && (
                    <Link
                        to={`/topic/${event.topic}`}
                        className="text-[11px] font-bold uppercase tracking-widest text-body hover:text-accent"
                    >
                        {TOPIC_LABELS[event.topic] || event.topic}
                    </Link>
                )}
                {event.countries.map((name) => (
                    <span key={name} className="text-[11px] font-bold uppercase tracking-widest text-muted">
                        {name}
                    </span>
                ))}
            </div>

            <h1 className="font-serif text-3xl md:text-4xl font-bold text-ink leading-[1.15] tracking-tight">
                {event.title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6 pb-6 mb-8 border-b border-rule">
                {[
                    [<Newspaper size={13} key="a" />, `${event.article_count} reports`],
                    [<Clock size={13} key="b" />, `over ${span < 48 ? `${span}h` : `${Math.round(span / 24)} days`}`],
                    [<AlertCircle size={13} key="c" />, `peak risk ${event.risk.toFixed(0)}`],
                ].map(([icon, label]) => (
                    <span key={label} className="flex items-center gap-1.5 text-[13px] text-body">
                        {icon} {label}
                    </span>
                ))}
                <span className="text-[13px] text-muted">
                    first reported {timeAgo(event.first_seen)}
                </span>
                <AskAbout
                    question={`What is the latest on this: ${event.title}`}
                    label="Ask the archive"
                />
                <SaveStory item={{
                    kind: 'event',
                    id: event.event_key,
                    title: event.title,
                    country: event.countries?.[0],
                    topic: event.topic,
                    published: event.first_seen?.slice(0, 10),
                }} />
            </div>

            <TermChips title={event.title} className="-mt-4 mb-8" />

            {Object.keys(event.figures || {}).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
                    {Object.entries(event.figures).map(([kind, value]) => (
                        <div key={kind} className="p-4 rounded-2xl bg-surface border border-rule">
                            <p className="font-display text-2xl font-black tabular-nums" style={{ color }}>
                                {value.toLocaleString()}
                            </p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted mt-1">
                                {FIGURE_LABELS[kind] || kind}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            {Object.entries(event.timeline || {})
                .filter(([, points]) => points.length > 1)
                .map(([kind, points]) => (
                    <FigureTimeline key={kind} kind={kind} points={points} />
                ))}

            <CoveragePanel coverage={event.coverage} />
            <FramingPanel framing={event.framing} />

            <section className="mb-10">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-body mb-3">
                    Reported by {event.outlet_count} outlets
                </h2>
                <div className="flex flex-wrap gap-2">
                    {event.outlets.map((name) => (
                        <span
                            key={name}
                            className="px-2.5 py-1 rounded-lg bg-surface-sunken border border-rule text-[11px] font-semibold text-body"
                        >
                            {name}
                        </span>
                    ))}
                </div>
            </section>

            <section>
                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-body pb-3 border-b border-rule">
                    All coverage
                </h2>
                <div className="divide-y divide-rule">
                    {event.articles.map((article) => (
                        <StoryRow key={article.id} article={article} />
                    ))}
                </div>
            </section>
        </div>
    );
};

export default EventPage;
