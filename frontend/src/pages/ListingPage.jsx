import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { getArticles } from '../services/api';
import { LeadStory, StoryCard } from '../components/StoryCards';
import { LeadStorySkeleton, StoryGridSkeleton } from '../components/Skeleton';

const PER_PAGE = 12;

/**
 * Shared listing used by the country, topic and search routes.
 *
 * They differ only in which filter they pin and what they call themselves, so
 * they share one implementation rather than three near-copies that drift.
 *
 * The first result is promoted to a lead: a section front with a flat grid
 * reads as a dashboard, and hierarchy is what makes it read as a publication.
 */
const ListingPage = ({ title, standfirst, filters, emptyMessage, headerExtra, promoteLead = true }) => {
    const [articles, setArticles] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const requestSeq = useRef(0);

    // Filters arrive as a fresh object each render; comparing the serialised
    // form keeps the fetch effect from firing on identity alone.
    const filterKey = JSON.stringify(filters);

    useEffect(() => { setPage(1); }, [filterKey]);

    const load = useCallback(async () => {
        const seq = ++requestSeq.current;
        setLoading(true);
        setError(null);
        try {
            const res = await getArticles({
                ...JSON.parse(filterKey),
                limit: PER_PAGE,
                offset: (page - 1) * PER_PAGE,
            });
            if (seq !== requestSeq.current) return;
            setArticles(res.data?.items || []);
            setTotal(res.data?.total || 0);
        } catch (err) {
            if (seq !== requestSeq.current) return;
            console.error(err);
            setArticles([]);
            setTotal(0);
            setError('Could not reach the newsroom service. Check that the API is running.');
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [filterKey, page]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [page]);

    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    const [lead, ...rest] = articles;
    const showLead = promoteLead && page === 1 && lead;
    const grid = useMemo(() => (showLead ? rest : articles), [showLead, rest, articles]);

    return (
        <div className="max-w-[1440px] mx-auto px-6 py-8 lg:py-12">
            <header className="mb-10 pb-6 border-b border-white/10">
                <h1 className="font-display text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                    {title}
                </h1>
                {standfirst && (
                    <p className="mt-2 text-[15px] text-slate-400 leading-relaxed max-w-2xl">{standfirst}</p>
                )}
                {headerExtra}
                {!loading && !error && (
                    <p className="mt-3 text-[13px] text-slate-500 tabular-nums">
                        {total.toLocaleString()} {total === 1 ? 'story' : 'stories'}
                    </p>
                )}
            </header>

            {loading ? (
                <div className="space-y-8">
                    {promoteLead && page === 1 && <LeadStorySkeleton />}
                    <StoryGridSkeleton count={6} />
                </div>
            ) : error ? (
                <div className="py-24 text-center space-y-4">
                    <p className="text-slate-400 max-w-md mx-auto">{error}</p>
                    <button onClick={load} className="btn-primary">Try again</button>
                </div>
            ) : articles.length === 0 ? (
                <div className="py-24 text-center space-y-4">
                    <SearchX size={32} className="text-slate-700 mx-auto" />
                    <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
                        {emptyMessage || 'Nothing matches these filters yet.'}
                    </p>
                    <Link to="/" className="btn-primary inline-block">Back to the front page</Link>
                </div>
            ) : (
                <div className="space-y-10">
                    {showLead && <LeadStory article={lead} />}

                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                        {grid.map((article) => <StoryCard key={article.id} article={article} />)}
                    </div>

                    {totalPages > 1 && (
                        <nav aria-label="Pagination" className="flex items-center justify-between pt-8 border-t border-white/10">
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-[13px] font-semibold text-slate-300 hover:border-cyan-500/40 disabled:opacity-30 disabled:pointer-events-none transition-all"
                            >
                                <ChevronLeft size={15} /> Newer
                            </button>
                            <span className="text-[13px] text-slate-500 tabular-nums">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 text-[13px] font-semibold text-slate-300 hover:border-cyan-500/40 disabled:opacity-30 disabled:pointer-events-none transition-all"
                            >
                                Older <ChevronRight size={15} />
                            </button>
                        </nav>
                    )}
                </div>
            )}
        </div>
    );
};

export default ListingPage;
