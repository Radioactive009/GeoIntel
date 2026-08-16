import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Search, ChevronDown } from 'lucide-react';
import Logo from './Logo';
import FreshnessBadge from './FreshnessBadge';

/**
 * Masthead.
 *
 * Twelve items sat here as equals — the brief, the assistant and seven topic
 * facets all at the same weight, which is a list rather than a navigation and
 * was the loudest thing making the page look unconsidered.
 *
 * Now four destinations and one menu. The topics are facets of a single feed,
 * not peers of the brief, so they live behind Sections; the study hub carries
 * the India desk, glossary and saved stories with it.
 */
const PRIMARY = [
    { to: '/brief', label: 'Brief' },
    { to: '/events', label: 'Events' },
    { to: '/study', label: 'Study' },
    { to: '/ask', label: 'Ask' },
];

const TOPICS = [
    { to: '/topic/conflict', label: 'Conflict' },
    { to: '/topic/security', label: 'Security' },
    { to: '/topic/diplomacy', label: 'Diplomacy' },
    { to: '/topic/economy', label: 'Economy' },
    { to: '/topic/politics', label: 'Politics' },
    { to: '/topic/disaster', label: 'Disasters' },
    { to: '/topic/humanitarian', label: 'Humanitarian' },
];

const DESKS = [
    { to: '/india', label: 'India & the world' },
    { to: '/glossary', label: 'Groupings & institutions' },
    { to: '/notes', label: 'Saved stories' },
];

const linkClass = ({ isActive }) =>
    `text-[14px] transition-colors ${
        isActive ? 'text-ink font-semibold' : 'text-body hover:text-ink'
    }`;

const SiteHeader = () => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [sectionsOpen, setSectionsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const navigate = useNavigate();
    const location = useLocation();
    const sectionsRef = useRef(null);

    // A navigation should not leave its own menu open behind it.
    useEffect(() => { setMenuOpen(false); setSectionsOpen(false); }, [location.pathname]);

    // A menu that only closes by choosing something from it is a trap.
    useEffect(() => {
        if (!sectionsOpen) return undefined;
        const dismiss = (event) => {
            if (!sectionsRef.current?.contains(event.target)) setSectionsOpen(false);
        };
        const onKey = (event) => { if (event.key === 'Escape') setSectionsOpen(false); };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', dismiss);
            document.removeEventListener('keydown', onKey);
        };
    }, [sectionsOpen]);

    const submit = (e) => {
        e.preventDefault();
        const term = query.trim();
        if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
    };

    const inSections = location.pathname.startsWith('/topic/');

    return (
        <header className="sticky top-0 z-50 border-b border-rule bg-paper/95 backdrop-blur-sm">
            <div className="max-w-[1200px] mx-auto px-6">
                <div className="flex items-center justify-between gap-8 py-4">
                    <Link to="/" className="shrink-0 transition-opacity hover:opacity-70" aria-label="GeoIntel home">
                        <Logo />
                    </Link>

                    <nav aria-label="Main" className="hidden lg:flex items-center gap-7">
                        {PRIMARY.map((item) => (
                            <NavLink key={item.to} to={item.to} className={linkClass}>
                                {item.label}
                            </NavLink>
                        ))}

                        <div className="relative" ref={sectionsRef}>
                            <button
                                onClick={() => setSectionsOpen((open) => !open)}
                                aria-expanded={sectionsOpen}
                                aria-haspopup="true"
                                className={`flex items-center gap-1 text-[14px] transition-colors ${
                                    inSections ? 'text-ink font-semibold' : 'text-body hover:text-ink'
                                }`}
                            >
                                Sections
                                <ChevronDown
                                    size={13}
                                    className={`transition-transform ${sectionsOpen ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {sectionsOpen && (
                                <div className="absolute right-0 top-full mt-3 w-60 py-2 rounded-xl border border-rule bg-surface shadow-lg shadow-ink/5">
                                    {TOPICS.map((item) => (
                                        <NavLink
                                            key={item.to}
                                            to={item.to}
                                            className="block px-4 py-1.5 text-[13px] text-body hover:text-ink hover:bg-surface-sunken transition-colors"
                                        >
                                            {item.label}
                                        </NavLink>
                                    ))}
                                    <div className="my-2 border-t border-rule" />
                                    {DESKS.map((item) => (
                                        <NavLink
                                            key={item.to}
                                            to={item.to}
                                            className="block px-4 py-1.5 text-[13px] text-body hover:text-ink hover:bg-surface-sunken transition-colors"
                                        >
                                            {item.label}
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    </nav>

                    <div className="flex items-center gap-4">
                        <FreshnessBadge />

                        <form onSubmit={submit} className="hidden md:block relative">
                            <label htmlFor="site-search" className="sr-only">Search stories</label>
                            <input
                                id="site-search"
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search"
                                className="w-36 lg:w-44 bg-transparent border-b border-rule pl-6 pr-2 py-1 text-[13px] text-ink placeholder:text-faint outline-none focus:border-ink transition-colors"
                            />
                            <Search size={13} className="absolute left-0 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                        </form>

                        <button
                            className="lg:hidden p-1 text-body hover:text-ink transition-colors"
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-expanded={menuOpen}
                            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        >
                            {menuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
            </div>

            <div className={`lg:hidden overflow-hidden transition-all duration-300 ${menuOpen ? 'max-h-[32rem] border-t border-rule' : 'max-h-0'}`}>
                <nav aria-label="Main" className="max-w-[1200px] mx-auto px-6 py-5 flex flex-col gap-3">
                    {PRIMARY.map((item) => (
                        <NavLink key={item.to} to={item.to} className={linkClass}>{item.label}</NavLink>
                    ))}
                    <p className="mt-3 pt-3 border-t border-rule text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                        Sections
                    </p>
                    {TOPICS.map((item) => (
                        <NavLink key={item.to} to={item.to} className={linkClass}>{item.label}</NavLink>
                    ))}
                    {DESKS.map((item) => (
                        <NavLink key={item.to} to={item.to} className={linkClass}>{item.label}</NavLink>
                    ))}
                    <form onSubmit={submit} className="pt-3">
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search stories"
                            aria-label="Search stories"
                            className="w-full bg-transparent border-b border-rule px-1 py-2 text-sm text-ink placeholder:text-faint outline-none focus:border-ink"
                        />
                    </form>
                </nav>
            </div>
        </header>
    );
};

export default SiteHeader;
