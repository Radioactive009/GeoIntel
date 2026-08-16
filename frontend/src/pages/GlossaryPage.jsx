import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, Search } from 'lucide-react';
import { CATEGORIES, TERMS } from '../lib/glossary';
import Seo from '../components/Seo';

/**
 * What the acronyms in the headlines mean.
 *
 * Reference rather than reporting, and the only page here whose content is
 * written rather than computed — which is why it says so at the bottom and
 * links onward for anything load-bearing.
 */
const GlossaryPage = () => {
    const [query, setQuery] = useState('');
    const { hash } = useLocation();

    // Arriving from a chip on a story lands on that entry.
    useEffect(() => {
        if (!hash) return;
        const target = document.getElementById(hash.slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [hash]);

    const grouped = useMemo(() => {
        const term = query.trim().toLowerCase();
        const matches = term
            ? TERMS.filter((entry) => (
                entry.name.toLowerCase().includes(term)
                || entry.what.toLowerCase().includes(term)
                || entry.match.some((form) => form.toLowerCase().includes(term))
            ))
            : TERMS;

        return Object.entries(CATEGORIES)
            .map(([key, label]) => [label, matches.filter((entry) => entry.category === key)])
            .filter(([, entries]) => entries.length > 0);
    }, [query]);

    return (
        <div className="max-w-3xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title="Glossary"
                description="The groupings, institutions and agreements that recur in world coverage — what each one is, and where India stands in it."
                path="/glossary"
            />

            <header className="border-b border-white/10 pb-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-400">
                    Reference
                </p>
                <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    Groupings &amp; institutions
                </h1>
                <p className="mt-3 text-[15px] text-slate-400 leading-relaxed max-w-2xl">
                    The bodies and agreements that turn up in coverage without explanation. Each
                    entry says what it is and, where there is a specific fact worth knowing, where
                    India stands in it.
                </p>

                <div className="mt-5 relative">
                    <label htmlFor="glossary-search" className="sr-only">Search the glossary</label>
                    <input
                        id="glossary-search"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search — SCO, chokepoint, treaty…"
                        className="w-full bg-slate-900/60 border border-white/10 rounded-2xl pl-10 pr-4 py-2.5 text-[14px] text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-colors"
                    />
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                </div>
            </header>

            {grouped.length === 0 && (
                <p className="mt-10 text-[14px] text-slate-400">
                    Nothing matches “{query}”.{' '}
                    <Link to="/ask" className="text-cyan-400 hover:underline">Ask the archive</Link>{' '}
                    instead — it can answer from the articles themselves.
                </p>
            )}

            {grouped.map(([label, entries]) => (
                <section key={label} className="mt-10">
                    <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">
                        <BookOpen size={13} className="text-cyan-400" />
                        {label}
                    </h2>
                    <div className="space-y-5">
                        {entries.map((entry) => (
                            <article
                                key={entry.id}
                                id={entry.id}
                                className="scroll-mt-24 p-5 rounded-2xl border border-white/10 bg-slate-900/40 target:border-cyan-500/40"
                            >
                                <h3 className="font-display text-[17px] font-bold text-white">
                                    {entry.name}
                                </h3>
                                <p className="mt-2 text-[14px] text-slate-300 leading-[1.7]">
                                    {entry.what}
                                </p>
                                {entry.india && (
                                    <p className="mt-2.5 text-[13px] text-slate-400 leading-relaxed">
                                        <span className="font-semibold text-slate-300">India: </span>
                                        {entry.india}
                                    </p>
                                )}
                                <Link
                                    to={`/search?q=${encodeURIComponent(entry.match[0])}`}
                                    className="mt-3 inline-block text-[12px] font-semibold text-slate-500 hover:text-cyan-400 transition-colors"
                                >
                                    Coverage mentioning it →
                                </Link>
                            </article>
                        ))}
                    </div>
                </section>
            ))}

            <p className="mt-12 pt-6 border-t border-white/10 text-[12px] text-slate-600 leading-relaxed">
                These are written summaries, not sources — the one part of this site that is not
                computed from the archive. Memberships and mandates change; check the body&apos;s own
                material before relying on a detail in anything that is marked.
            </p>
        </div>
    );
};

export default GlossaryPage;
