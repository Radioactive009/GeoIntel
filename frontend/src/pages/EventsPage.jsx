import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Clock, Radio, Scale } from 'lucide-react';
import { getEvents, getContested } from '../services/api';
import { getAlertColor } from '../utils/country';
import { timeAgo } from '../utils/time';
import Seo from '../components/Seo';

const WINDOWS = [
    { hours: 24, label: '24h' },
    { hours: 72, label: '3d' },
    { hours: 168, label: '7d' },
    { hours: 720, label: '30d' },
];

const FIGURE_LABELS = {
    deaths: 'dead', injured: 'injured', missing: 'missing',
    displaced: 'displaced', rescued: 'rescued',
};

/**
 * Events ranked by how widely they were covered.
 *
 * A front page ranks stories; this ranks *happenings*. The distinction is the
 * point — an earthquake covered by 31 outlets is one event here and 76
 * separate cards in the feed, and how many outlets picked something up is a
 * measure of significance the feed cannot express.
 */
const EventsPage = () => {
    const [events, setEvents] = useState([]);
    const [contested, setContested] = useState([]);
    const [hours, setHours] = useState(168);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            getEvents({ hours, limit: 30, minArticles: 3 }),
            getContested({ hours, limit: 5 }).catch(() => null),
        ])
            .then(([eventRes, contestedRes]) => {
                if (cancelled) return;
                setEvents(eventRes.data?.events || []);
                setContested(contestedRes?.data?.events || []);
            })
            .catch((err) => { if (!cancelled) { console.error(err); setEvents([]); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [hours]);

    const busiest = Math.max(1, ...events.map((e) => e.article_count));

    return (
        <div className="max-w-[1100px] mx-auto px-6 py-8 lg:py-12">
            <Seo
                title="Major events"
                description="Happenings ranked by how many outlets covered them, with reported figures as they developed."
                path="/events"
            />

            <header className="mb-10 pb-6 border-b border-rule flex items-end justify-between flex-wrap gap-4">
                <div>
                    <h1 className="font-display text-3xl md:text-4xl font-extrabold text-ink tracking-tight">
                        Major events
                    </h1>
                    <p className="mt-2 text-[15px] text-body max-w-2xl leading-relaxed">
                        Articles grouped into the happenings they describe, ranked by how many
                        outlets carried each one.
                    </p>
                </div>
                <div className="flex bg-surface p-1 rounded-xl border border-rule gap-1">
                    {WINDOWS.map((w) => (
                        <button
                            key={w.hours}
                            onClick={() => setHours(w.hours)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                hours === w.hours
                                    ? 'bg-accent text-ink'
                                    : 'text-muted hover:text-body'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
            </header>

            {/* Disagreement is its own kind of story, and only visible once
                articles are grouped by the happening they describe. */}
            {contested.length > 0 && !loading && (
                <section className="mb-10 p-5 rounded-2xl border border-rule bg-surface">
                    <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-body mb-1">
                        <Scale size={13} /> Outlets disagreed most on
                    </h2>
                    <p className="text-[12px] text-faint mb-4">
                        Ranked by how widely severity readings varied across every outlet that
                        covered the story.
                    </p>
                    <ul className="space-y-2">
                        {contested.map((e) => (
                            <li key={e.event_key}>
                                <Link
                                    to={`/event/${e.event_key}`}
                                    className="group flex items-center gap-4 py-2"
                                >
                                    <span className="font-display text-base font-black tabular-nums text-risk-medium w-10 shrink-0">
                                        {e.spread.toFixed(0)}
                                    </span>
                                    <span className="min-w-0 flex-grow">
                                        <span className="block text-[13px] font-semibold text-ink truncate group-hover:text-accent transition-colors">
                                            {e.title}
                                        </span>
                                        <span className="block text-[11px] text-faint truncate">
                                            {e.highest.source} {e.highest.score} · {e.lowest.source} {e.lowest.score}
                                            <span className="text-faint"> · {e.outlet_count} outlets</span>
                                        </span>
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-24 rounded-2xl bg-surface-sunken animate-pulse" />
                    ))}
                </div>
            ) : events.length === 0 ? (
                <div className="py-24 text-center">
                    <p className="text-body">
                        No events with three or more reports in this window yet.
                    </p>
                </div>
            ) : (
                <ol className="space-y-3">
                    {events.map((event, index) => {
                        const color = getAlertColor(
                            event.risk >= 70 ? 'high' : event.risk >= 40 ? 'medium' : 'low'
                        );
                        return (
                            <li key={event.event_key}>
                                <Link
                                    to={`/event/${event.event_key}`}
                                    className="group flex gap-4 p-4 rounded-2xl border border-rule bg-surface hover:border-rule-strong transition-colors"
                                >
                                    <span className="font-display text-lg font-black text-faint tabular-nums w-8 shrink-0 pt-0.5">
                                        {index + 1}
                                    </span>

                                    {event.image_url && (
                                        <div className="hidden sm:block w-28 aspect-[4/3] rounded-xl overflow-hidden bg-surface shrink-0">
                                            <img
                                                src={event.image_url}
                                                alt=""
                                                aria-hidden="true"
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                className="w-full h-full object-cover"
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                            />
                                        </div>
                                    )}

                                    <div className="min-w-0 flex-grow">
                                        <h2 className="font-serif text-lg font-semibold text-ink leading-snug line-clamp-2 group-hover:text-accent transition-colors">
                                            {event.title}
                                        </h2>

                                        <div className="flex items-center gap-3 mt-2 flex-wrap text-[12px] text-muted">
                                            <span className="flex items-center gap-1.5">
                                                <Newspaper size={11} /> {event.article_count} reports
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Radio size={11} /> {event.outlet_count} outlets
                                            </span>
                                            <span className="flex items-center gap-1.5">
                                                <Clock size={11} /> {timeAgo(event.last_seen)}
                                            </span>
                                            {Object.entries(event.figures || {}).slice(0, 2).map(([kind, value]) => (
                                                <span key={kind} className="font-bold" style={{ color }}>
                                                    {value.toLocaleString()} {FIGURE_LABELS[kind] || kind}
                                                </span>
                                            ))}
                                        </div>

                                        {/* Reach relative to the biggest event in the window. */}
                                        <div className="mt-2.5 h-1 rounded-full bg-surface-sunken overflow-hidden max-w-md">
                                            <div
                                                className="h-full rounded-full transition-all duration-700"
                                                style={{ width: `${(event.article_count / busiest) * 100}%`, background: color }}
                                            />
                                        </div>
                                    </div>
                                </Link>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
};

export default EventsPage;
