import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Clock, Radio } from 'lucide-react';
import { getEvents } from '../services/api';
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
    const [hours, setHours] = useState(168);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getEvents({ hours, limit: 30, minArticles: 3 })
            .then((res) => { if (!cancelled) setEvents(res.data?.events || []); })
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

            <header className="mb-10 pb-6 border-b border-white/10 flex items-end justify-between flex-wrap gap-4">
                <div>
                    <h1 className="font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                        Major events
                    </h1>
                    <p className="mt-2 text-[15px] text-slate-400 max-w-2xl leading-relaxed">
                        Articles grouped into the happenings they describe, ranked by how many
                        outlets carried each one.
                    </p>
                </div>
                <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5 gap-1">
                    {WINDOWS.map((w) => (
                        <button
                            key={w.hours}
                            onClick={() => setHours(w.hours)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                                hours === w.hours
                                    ? 'bg-cyan-500 text-white'
                                    : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
            </header>

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" />
                    ))}
                </div>
            ) : events.length === 0 ? (
                <div className="py-24 text-center">
                    <p className="text-slate-400">
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
                                    className="group flex gap-4 p-4 rounded-2xl border border-white/10 bg-slate-900/30 hover:border-white/20 transition-colors"
                                >
                                    <span className="font-display text-lg font-black text-slate-700 tabular-nums w-8 shrink-0 pt-0.5">
                                        {index + 1}
                                    </span>

                                    {event.image_url && (
                                        <div className="hidden sm:block w-28 aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 shrink-0">
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
                                        <h2 className="font-serif text-lg font-semibold text-white leading-snug line-clamp-2 group-hover:text-cyan-300 transition-colors">
                                            {event.title}
                                        </h2>

                                        <div className="flex items-center gap-3 mt-2 flex-wrap text-[12px] text-slate-500">
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
                                        <div className="mt-2.5 h-1 rounded-full bg-slate-800/60 overflow-hidden max-w-md">
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
