import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Scale, Newspaper, Clock } from 'lucide-react';
import { getBrief } from '../services/api';
import Seo from '../components/Seo';
import Skeleton from '../components/Skeleton';

/**
 * The daily brief.
 *
 * Every other page here answers a question the reader arrived with. This
 * answers the one they start with — what should I know — and it is the only
 * page that speaks in the site's own voice rather than quoting an outlet.
 *
 * Which is why the numbers stay visible next to every claim. The summary is
 * composed from counts on the server, and showing the count beside the
 * sentence is what lets a reader tell that apart from a machine's prose.
 */

const WINDOWS = [
    { hours: 24, label: '24 hours' },
    { hours: 72, label: '3 days' },
    { hours: 168, label: 'a week' },
];

const Figure = ({ value, label }) => (
    <div>
        <p className="font-display text-2xl font-extrabold text-white tabular-nums">
            {value.toLocaleString()}
        </p>
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 mt-0.5">{label}</p>
    </div>
);

const Section = ({ icon: Icon, title, children }) => (
    <section className="mt-10">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">
            <Icon size={13} className="text-cyan-400" />
            {title}
        </h2>
        {children}
    </section>
);

const BriefPage = () => {
    const [hours, setHours] = useState(24);
    const [brief, setBrief] = useState(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let live = true;
        setBrief(null);
        setFailed(false);
        getBrief(hours)
            .then((r) => { if (live) setBrief(r.data); })
            .catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [hours]);

    const tone = brief?.coverage?.tone || {};
    const toned = (tone.serious || 0) + (tone.uplifting || 0) + (tone.neutral || 0);

    return (
        <div className="max-w-3xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title="The Brief"
                description="What to know from the last day of world coverage: the most widely reported events, where risk is rising, and where outlets disagree."
                path="/brief"
            />

            <header className="border-b border-white/10 pb-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-400">
                    The Brief
                </p>
                <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    What to know
                </h1>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                    {WINDOWS.map((w) => (
                        <button
                            key={w.hours}
                            onClick={() => setHours(w.hours)}
                            className={`px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors ${
                                hours === w.hours
                                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                    : 'border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                    {brief && (
                        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-600">
                            <Clock size={11} />
                            {new Date(brief.generated_at + 'Z').toLocaleString()}
                        </span>
                    )}
                </div>
            </header>

            {failed && (
                <p className="mt-8 text-[14px] text-slate-400">
                    The brief could not be loaded. The archive may still be waking up.
                </p>
            )}

            {!brief && !failed && (
                <div className="mt-8 space-y-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-11/12" />
                    <Skeleton className="h-5 w-9/12" />
                </div>
            )}

            {brief && (
                <>
                    <p className="mt-8 font-serif text-[19px] md:text-[21px] leading-[1.65] text-slate-200">
                        {brief.summary}
                    </p>

                    <div className="mt-8 grid grid-cols-3 gap-4 py-5 border-y border-white/10">
                        <Figure value={brief.coverage.articles} label="reports" />
                        <Figure value={brief.coverage.outlets} label="outlets" />
                        <Figure value={brief.coverage.countries} label="countries" />
                    </div>

                    {brief.events.length > 0 && (
                        <Section icon={Newspaper} title="Most widely reported">
                            <ol className="space-y-5">
                                {brief.events.map((event, index) => (
                                    <li key={event.event_key} className="flex gap-4">
                                        <span className="font-display text-lg font-extrabold text-slate-700 tabular-nums pt-0.5">
                                            {index + 1}
                                        </span>
                                        <div className="min-w-0">
                                            <Link
                                                to={`/event/${event.event_key}`}
                                                className="font-display text-[17px] font-bold text-white leading-snug hover:text-cyan-400 transition-colors"
                                            >
                                                {event.title}
                                            </Link>
                                            <p className="mt-1.5 text-[12px] text-slate-500">
                                                {event.outlets} outlet{event.outlets === 1 ? '' : 's'}
                                                {' · '}{event.reports} report{event.reports === 1 ? '' : 's'}
                                                {event.countries.length > 0 && ` · ${event.countries.join(', ')}`}
                                                {typeof event.figures?.deaths === 'number' &&
                                                    ` · ${event.figures.deaths.toLocaleString()} reported dead`}
                                            </p>
                                            {event.outlet_names.length > 0 && (
                                                <p className="mt-1 text-[11px] text-slate-600 truncate">
                                                    {event.outlet_names.join(' · ')}
                                                </p>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </Section>
                    )}

                    {brief.escalating.length > 0 && (
                        <Section icon={TrendingUp} title="Risk rising fastest">
                            <ul className="space-y-2.5">
                                {brief.escalating.map((row) => (
                                    <li key={row.country} className="flex items-baseline justify-between gap-4">
                                        <Link
                                            to={row.iso_code ? `/country/${row.iso_code}` : '#'}
                                            className="text-[15px] text-slate-200 hover:text-cyan-400 transition-colors"
                                        >
                                            {row.country}
                                        </Link>
                                        <span className="text-[12px] text-slate-500 tabular-nums shrink-0">
                                            {row.baseline} → {row.current}
                                            <span className="text-amber-400/80 ml-2">+{row.sigma}σ</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-3 text-[11px] text-slate-600">
                                Measured against each country&apos;s own recent baseline, so a
                                consistently tense country does not top this by default.
                            </p>
                        </Section>
                    )}

                    {brief.contested.length > 0 && (
                        <Section icon={Scale} title="Where outlets disagreed">
                            <ul className="space-y-3">
                                {brief.contested.map((row) => (
                                    <li key={row.event_key}>
                                        <Link
                                            to={`/event/${row.event_key}`}
                                            className="text-[15px] text-slate-200 hover:text-cyan-400 transition-colors leading-snug"
                                        >
                                            {row.title}
                                        </Link>
                                        <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">
                                            {row.outlets} outlets · spread {row.spread} around {row.consensus}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    )}

                    {toned > 0 && (
                        <Section icon={Scale} title="Tone of coverage">
                            <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                                <div className="bg-rose-500/70" style={{ width: `${(tone.serious / toned) * 100}%` }} />
                                <div className="bg-slate-600" style={{ width: `${(tone.neutral / toned) * 100}%` }} />
                                <div className="bg-emerald-500/70" style={{ width: `${(tone.uplifting / toned) * 100}%` }} />
                            </div>
                            <p className="mt-2.5 text-[12px] text-slate-500">
                                {tone.serious} serious · {tone.neutral} neutral · {tone.uplifting} uplifting
                            </p>
                        </Section>
                    )}

                    <p className="mt-12 pt-6 border-t border-white/10 text-[12px] text-slate-600 leading-relaxed">
                        Assembled from figures the pipeline counted — not written by a language
                        model. Every number here is traceable to articles in the archive.{' '}
                        <Link to="/methodology" className="text-slate-500 hover:text-cyan-400 underline">
                            How this is measured
                        </Link>
                    </p>
                </>
            )}
        </div>
    );
};

export default BriefPage;
