import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    GraduationCap, Printer, Copy, Check, Scale, TrendingUp, BookOpen, Bookmark, Globe2, Sparkles,
} from 'lucide-react';
import { getBrief } from '../services/api';
import { briefToMarkdown } from '../lib/studyNotes';
import { findTerms } from '../lib/glossary';
import Seo from '../components/Seo';
import Skeleton from '../components/Skeleton';

/**
 * A revision compilation.
 *
 * The brief answers "what happened today". This answers "what happened over
 * the period I have been away from it", which is the question someone
 * revising asks — and it is a different artifact: organised by theme rather
 * than by recency, printable, and exportable, because the reader will work
 * through it away from the site.
 *
 * Composed from the same counted figures as the brief, and shows them. A
 * compilation that says "widely reported" without saying by how many outlets
 * is exactly the unsourced claim this material is usually made of.
 */

const PERIODS = [
    { hours: 168, label: 'Past week', short: 'week', depth: 20 },
    { hours: 720, label: 'Past month', short: 'month', depth: 40 },
];

const TOPIC_LABELS = {
    conflict: 'Conflict', security: 'Security', diplomacy: 'Diplomacy',
    economy: 'Economy', politics: 'Politics', disaster: 'Disasters',
    humanitarian: 'Humanitarian', other: 'Everything else',
};

const Shortcut = ({ to, icon: Icon, title, children }) => (
    <Link
        to={to}
        className="flex gap-3 p-4 rounded-2xl border border-rule bg-surface-sunken hover:border-accent transition-colors"
    >
        <Icon size={16} className="text-accent mt-0.5 shrink-0" />
        <span className="min-w-0">
            <span className="block text-[14px] font-bold text-ink">{title}</span>
            <span className="block mt-0.5 text-[12px] text-muted leading-relaxed">{children}</span>
        </span>
    </Link>
);

const StudyPage = () => {
    const [period, setPeriod] = useState(PERIODS[0]);
    const [brief, setBrief] = useState(null);
    const [failed, setFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let live = true;
        setBrief(null);
        setFailed(false);
        getBrief(period.hours, { depth: period.depth })
            .then((r) => { if (live) setBrief(r.data); })
            .catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [period]);

    // Grouped by theme rather than listed by recency: material is revised by
    // subject, and a flat list of forty events in date order is not revisable.
    const byTopic = useMemo(() => {
        const groups = new Map();
        for (const event of brief?.events || []) {
            const topic = event.topic || 'other';
            if (!groups.has(topic)) groups.set(topic, []);
            groups.get(topic).push(event);
        }
        return [...groups].sort((a, b) => b[1].length - a[1].length);
    }, [brief]);

    const copy = async () => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        try {
            await navigator.clipboard.writeText(
                briefToMarkdown(brief, { origin, label: `past ${period.short}` }),
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard blocked */ }
    };

    return (
        <div className="max-w-3xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title="Study"
                description="A revision compilation of world coverage — the period's events grouped by theme, with the counts behind each one, printable and exportable."
                path="/study"
            />

            <header className="border-b border-rule pb-6 print:border-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-accent">
                    Study
                </p>
                <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold text-ink tracking-tight">
                    Revision compilation
                </h1>
                <p className="mt-3 text-[15px] text-body leading-relaxed max-w-2xl">
                    The period&apos;s coverage grouped by theme, with the number of outlets behind
                    each item. Assembled from counted figures, not written by a model — so every
                    line here can be traced back to the reports underneath it.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2 print:hidden">
                    {PERIODS.map((option) => (
                        <button
                            key={option.hours}
                            onClick={() => setPeriod(option)}
                            className={`px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors ${
                                period.hours === option.hours
                                    ? 'border-accent bg-accent-soft text-accent'
                                    : 'border-rule text-body hover:text-ink hover:border-rule-strong'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                    <span className="ml-auto flex items-center gap-2">
                        <button
                            onClick={copy}
                            disabled={!brief}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rule text-[12px] font-semibold text-body hover:text-ink hover:border-rule-strong transition-colors disabled:opacity-40"
                        >
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            {copied ? 'Copied' : 'Markdown'}
                        </button>
                        <button
                            onClick={() => window.print()}
                            disabled={!brief}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rule text-[12px] font-semibold text-body hover:text-ink hover:border-rule-strong transition-colors disabled:opacity-40"
                        >
                            <Printer size={12} /> Print
                        </button>
                    </span>
                </div>
            </header>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5 print:hidden">
                <Shortcut to="/india" icon={Globe2} title="India & the world">
                    Who India is in the news with, including stories filed under the other party.
                </Shortcut>
                <Shortcut to="/glossary" icon={BookOpen} title="Groupings & institutions">
                    What the acronyms mean, and where India stands in each.
                </Shortcut>
                <Shortcut to="/ask" icon={Sparkles} title="Ask in exam mode">
                    Structured answers with the facts that can be cited, and the sources shown.
                </Shortcut>
                <Shortcut to="/notes" icon={Bookmark} title="Saved stories">
                    What you have put aside, with your notes, exportable as Markdown.
                </Shortcut>
            </div>

            {failed && (
                <p className="mt-10 text-[14px] text-body">
                    The compilation could not be loaded. The archive may still be waking up.
                </p>
            )}

            {!brief && !failed && (
                <div className="mt-10 space-y-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-11/12" />
                    <Skeleton className="h-5 w-9/12" />
                </div>
            )}

            {brief && (
                <>
                    <p className="mt-10 font-serif text-[19px] leading-[1.65] text-ink">
                        {brief.summary}
                    </p>
                    <p className="mt-3 text-[12px] text-muted">
                        {brief.coverage.articles.toLocaleString()} reports ·{' '}
                        {brief.coverage.outlets} outlets · {brief.coverage.countries} countries
                    </p>

                    {byTopic.map(([topic, events]) => (
                        <section key={topic} className="mt-10 break-inside-avoid">
                            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted mb-4 pb-2 border-b border-rule">
                                {TOPIC_LABELS[topic] || topic}
                                <span className="ml-2 text-faint tabular-nums">{events.length}</span>
                            </h2>
                            <ol className="space-y-5">
                                {events.map((event) => {
                                    const terms = findTerms(event.title);
                                    return (
                                        <li key={event.event_key}>
                                            <Link
                                                to={`/event/${event.event_key}`}
                                                className="font-display text-[16px] font-bold text-ink leading-snug hover:text-accent transition-colors"
                                            >
                                                {event.title}
                                            </Link>
                                            <p className="mt-1.5 text-[12px] text-muted">
                                                {event.outlets} outlet{event.outlets === 1 ? '' : 's'}
                                                {' · '}{event.reports} report{event.reports === 1 ? '' : 's'}
                                                {event.countries.length > 0 && ` · ${event.countries.join(', ')}`}
                                                {Object.entries(event.figures || {})
                                                    .map(([kind, value]) => ` · ${value.toLocaleString()} ${kind}`)
                                                    .join('')}
                                            </p>
                                            {terms.length > 0 && (
                                                <p className="mt-1 text-[11px] text-faint">
                                                    {terms.map((term) => term.name).join(' · ')}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        </section>
                    ))}

                    {brief.contested.length > 0 && (
                        <section className="mt-12 break-inside-avoid">
                            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted mb-3">
                                <Scale size={13} className="text-accent" />
                                Where outlets disagreed
                            </h2>
                            {/* The most directly useful thing here for anyone who has
                                to write about an issue rather than recall it. */}
                            <p className="text-[13px] text-body leading-relaxed mb-4">
                                These are events the outlets in the archive framed most differently
                                from one another — measured by the spread in how serious each judged
                                the same story. An issue that reads as settled in one paper and
                                alarming in another is one where a written answer has to hold both
                                readings rather than pick one.
                            </p>
                            <ul className="space-y-3">
                                {brief.contested.map((row) => (
                                    <li key={row.event_key}>
                                        <Link
                                            to={`/event/${row.event_key}`}
                                            className="text-[15px] text-ink hover:text-accent transition-colors leading-snug"
                                        >
                                            {row.title}
                                        </Link>
                                        <p className="mt-0.5 text-[12px] text-muted tabular-nums">
                                            {row.outlets} outlets · spread {row.spread} around {row.consensus}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {brief.escalating.length > 0 && (
                        <section className="mt-12 break-inside-avoid">
                            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted mb-4">
                                <TrendingUp size={13} className="text-accent" />
                                Risk rising fastest
                            </h2>
                            <ul className="space-y-2.5">
                                {brief.escalating.map((row) => (
                                    <li key={row.country} className="flex items-baseline justify-between gap-4">
                                        <Link
                                            to={row.iso_code ? `/country/${row.iso_code}` : '#'}
                                            className="text-[15px] text-ink hover:text-accent transition-colors"
                                        >
                                            {row.country}
                                        </Link>
                                        <span className="text-[12px] text-muted tabular-nums shrink-0">
                                            {row.baseline} → {row.current}
                                            <span className="text-risk-medium ml-2">+{row.sigma}σ</span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <p className="mt-12 pt-6 border-t border-rule text-[12px] text-faint leading-relaxed">
                        <GraduationCap size={12} className="inline mr-1.5 -mt-0.5" />
                        Every figure here was counted from the archive, and every item links to the
                        reports behind it. Check them before writing anything down —{' '}
                        <Link to="/methodology" className="text-muted hover:text-accent underline">
                            how this is measured
                        </Link>.
                    </p>
                </>
            )}
        </div>
    );
};

export default StudyPage;
