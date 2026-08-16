import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe2, Users, Newspaper, ArrowRight } from 'lucide-react';
import { getAlertAnalysis, getArticles, getRelations } from '../services/api';
import { getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';
import { timeAgo } from '../utils/time';
import AskAbout from '../components/AskAbout';
import TermChips from '../components/TermChips';
import SaveStory from '../components/SaveStory';
import Seo from '../components/Seo';
import Skeleton from '../components/Skeleton';

/**
 * India and the world.
 *
 * The rest of the site is deliberately country-agnostic — every country gets
 * the same page, generated the same way. This one is not, and the reason is
 * the audience: readers following world affairs from India, including those
 * preparing for examinations where international relations is set as *India's*
 * relations, need the same coverage arranged around one country's stake in it.
 *
 * Everything here is a view of data the pipeline already had. The partner
 * board is the pair graph filtered to one country — built from the second
 * country the resolver finds in each article, which is also why the story list
 * asks for `includeSecondary`: a border story filed under China is India
 * coverage too, and the ordinary feed would not show it here.
 */

const DESK = { iso: 'IN', name: 'India' };

const Section = ({ icon: Icon, title, children, aside }) => (
    <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                <Icon size={13} className="text-cyan-400" />
                {title}
            </h2>
            {aside}
        </div>
        {children}
    </section>
);

const IndiaPage = () => {
    const [standing, setStanding] = useState(null);
    const [pairs, setPairs] = useState([]);
    const [stories, setStories] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let live = true;
        Promise.all([
            getAlertAnalysis(false).then((r) => r.data).catch(() => null),
            getRelations({ hours: 720, limit: 8, country: DESK.iso }).then((r) => r.data).catch(() => null),
            getArticles({ country: DESK.iso, includeSecondary: true, limit: 12 })
                .then((r) => r.data).catch(() => null),
        ]).then(([analysis, relations, feed]) => {
            if (!live) return;
            setStanding((analysis || []).find((row) => row.iso_code === DESK.iso) || null);
            setPairs(relations?.pairs || []);
            setStories(feed?.items || []);
            setLoading(false);
        });
        return () => { live = false; };
    }, []);

    const color = getAlertColor(standing?.alert_status);

    return (
        <div className="max-w-4xl mx-auto px-6 py-8 lg:py-12">
            <Seo
                title="India & the world"
                description="India's coverage arranged around its own stake in it: who India is in the news with, and what is being reported."
                path="/india"
            />

            <header className="border-b border-white/10 pb-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-400">
                    Country desk
                </p>
                <h1 className="mt-2 font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    India &amp; the world
                </h1>
                <p className="mt-3 text-[15px] text-slate-400 leading-relaxed max-w-2xl">
                    The same archive, arranged around one country&apos;s stake in it — who India is
                    in the news with, and what is being reported. Bilateral stories filed under the
                    other party are included, which the ordinary country feed leaves out.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Link
                        to={`/country/${DESK.iso}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[12px] font-semibold text-slate-400 hover:text-white hover:border-white/25 transition-colors"
                    >
                        All India coverage <ArrowRight size={12} />
                    </Link>
                    <AskAbout
                        question="What is happening in India right now, and what does it bear on?"
                        label="Ask the archive"
                    />
                </div>
            </header>

            {standing && (
                <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-4 p-5 rounded-2xl bg-slate-900/40 border border-white/10">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Risk level</p>
                        <p className="text-3xl font-black tabular-nums leading-none" style={{ color }}>
                            {standing.alert_level.toFixed(1)}<span className="text-base opacity-60">%</span>
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Status</p>
                        <p className="text-sm font-bold uppercase tracking-wider" style={{ color }}>
                            {ALERT_STATUS_LABEL[standing.alert_status] || 'Stable'}
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Reports held</p>
                        <p className="text-sm font-bold text-white tabular-nums">{standing.total_articles}</p>
                    </div>
                </div>
            )}

            {loading && (
                <div className="mt-10 space-y-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-5 w-10/12" />
                    <Skeleton className="h-5 w-8/12" />
                </div>
            )}

            {!loading && (
                <Section
                    icon={Users}
                    title="In the news with"
                    aside={<span className="text-[11px] text-slate-600">last 30 days</span>}
                >
                    {pairs.length === 0 ? (
                        <p className="text-[13px] text-slate-500">
                            No bilateral coverage in the window yet. Pairs appear once the archive
                            holds stories naming India alongside another country.
                        </p>
                    ) : (
                        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {pairs.map((pair) => {
                                // The board is undirected, so the partner is whichever
                                // side of the pair is not this desk's country.
                                const index = pair.iso_codes.indexOf(DESK.iso);
                                const partner = pair.countries[index === 0 ? 1 : 0];
                                const partnerIso = pair.iso_codes[index === 0 ? 1 : 0];
                                return (
                                    <li key={pair.iso_codes.join('-')}>
                                        <Link
                                            to={`/country/${partnerIso}`}
                                            className="flex items-baseline justify-between gap-3 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.02] hover:border-cyan-500/30 transition-colors"
                                        >
                                            <span className="text-[14px] font-semibold text-slate-200">
                                                India &middot; {partner}
                                            </span>
                                            <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                                                {pair.articles} report{pair.articles === 1 ? '' : 's'}
                                            </span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <p className="mt-3 text-[11px] text-slate-600">
                        Built from the second country named in each story, so a pair appears here
                        whichever side the report was filed under.
                    </p>
                </Section>
            )}

            {!loading && stories.length > 0 && (
                <Section icon={Newspaper} title="Latest coverage">
                    <ul className="space-y-5">
                        {stories.map((story) => (
                            <li key={story.id} className="pb-5 border-b border-white/5 last:border-0">
                                <Link
                                    to={`/story/${story.id}`}
                                    className="font-display text-[17px] font-bold text-white leading-snug hover:text-cyan-400 transition-colors"
                                >
                                    {story.title}
                                </Link>
                                <p className="mt-1.5 text-[12px] text-slate-500">
                                    <span className="font-semibold text-slate-400">
                                        {story.source?.name || 'Unknown'}
                                    </span>
                                    {' · '}{timeAgo(story.published_at)}
                                    {story.country && ` · ${story.country}`}
                                    {story.country_secondary && ` & ${story.country_secondary}`}
                                </p>
                                <TermChips title={story.title} description={story.description} className="mt-2.5" />
                                <div className="mt-2.5">
                                    <SaveStory item={{
                                        id: story.id,
                                        title: story.title,
                                        source: story.source?.name,
                                        country: story.country,
                                        topic: story.event_type,
                                        published: story.published_at?.slice(0, 10),
                                    }} />
                                </div>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}

            {!loading && stories.length === 0 && (
                <Section icon={Globe2} title="Latest coverage">
                    <p className="text-[13px] text-slate-500">
                        Nothing held for India in this window yet.
                    </p>
                </Section>
            )}
        </div>
    );
};

export default IndiaPage;
