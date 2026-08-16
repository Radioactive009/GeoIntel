import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import ListingPage from './ListingPage';
import Seo from '../components/Seo';

/**
 * Search results.
 *
 * The term lives in the URL rather than component state, so a search is
 * shareable and survives a reload — which is the whole point of putting
 * routing in.
 */
const SearchPage = () => {
    const [params, setParams] = useSearchParams();
    const term = (params.get('q') || '').trim();

    const submit = (e) => {
        e.preventDefault();
        const next = new FormData(e.currentTarget).get('q').toString().trim();
        setParams(next ? { q: next } : {});
    };

    const form = (
        <form onSubmit={submit} className="mt-5 relative max-w-lg">
            <label htmlFor="search-input" className="sr-only">Search stories</label>
            <input
                id="search-input"
                name="q"
                type="search"
                defaultValue={term}
                key={term}
                placeholder="Search headlines and summaries"
                className="w-full bg-surface border border-rule rounded-full pl-11 pr-4 py-3 text-[15px] text-ink placeholder:text-faint outline-none focus:border-accent transition-colors"
            />
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </form>
    );

    if (!term) {
        return (
            <div className="max-w-[1440px] mx-auto px-6 py-8 lg:py-12">
                <Seo title="Search" path="/search" noIndex />
                <header className="mb-10 pb-6 border-b border-rule">
                    <h1 className="font-display text-3xl md:text-4xl font-extrabold text-ink tracking-tight">Search</h1>
                    <p className="mt-2 text-[15px] text-body">
                        Search every headline and summary in the archive.
                    </p>
                    {form}
                </header>
            </div>
        );
    }

    return (
        <>
            <Seo title={`Search: ${term}`} path={`/search?q=${encodeURIComponent(term)}`} noIndex />
            <ListingPage
                title={`Search: “${term}”`}
                filters={{ q: term }}
                headerExtra={form}
                promoteLead={false}
                emptyMessage={`Nothing matched “${term}”. Try a country, a leader's name, or a broader term.`}
            />
        </>
    );
};

export default SearchPage;
