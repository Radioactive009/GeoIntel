import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Menu, X, Search } from 'lucide-react';
import Logo from './Logo';
import FreshnessBadge from './FreshnessBadge';

/**
 * Masthead.
 *
 * Sections are the event types the risk engine already assigns, so the
 * navigation is generated from real data rather than being decorative.
 */
const SECTIONS = [
    { to: '/', label: 'Home', end: true },
    { to: '/topic/military', label: 'Conflict' },
    { to: '/topic/diplomatic', label: 'Diplomacy' },
    { to: '/topic/economic', label: 'Economy' },
    { to: '/topic/political', label: 'Politics' },
    { to: '/topic/hazard', label: 'Hazards' },
];

const linkClass = ({ isActive }) =>
    `text-[13px] font-semibold transition-colors ${
        isActive ? 'text-cyan-400' : 'text-slate-400 hover:text-white'
    }`;

const SiteHeader = () => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [query, setQuery] = useState('');
    const navigate = useNavigate();
    const location = useLocation();

    // A navigation should not leave its own menu open behind it.
    useEffect(() => { setMenuOpen(false); }, [location.pathname]);

    const submit = (e) => {
        e.preventDefault();
        const term = query.trim();
        if (term) navigate(`/search?q=${encodeURIComponent(term)}`);
    };

    return (
        <header className="sticky top-0 z-50 glass-strong border-b border-white/10 bg-background/85 backdrop-blur-xl">
            <div className="max-w-[1440px] mx-auto px-6">
                <div className="flex items-center justify-between gap-6 py-3.5">
                    <Link to="/" className="shrink-0 transition-opacity hover:opacity-80" aria-label="GeoIntel home">
                        <Logo />
                    </Link>

                    <nav aria-label="Sections" className="hidden lg:flex items-center gap-6">
                        {SECTIONS.map((section) => (
                            <NavLink key={section.to} to={section.to} end={section.end} className={linkClass}>
                                {section.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="flex items-center gap-3">
                        <FreshnessBadge />

                        <form onSubmit={submit} className="hidden md:block relative">
                            <label htmlFor="site-search" className="sr-only">Search stories</label>
                            <input
                                id="site-search"
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search"
                                className="w-40 lg:w-52 bg-slate-900/60 border border-white/10 rounded-full pl-9 pr-3 py-1.5 text-[13px] text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/40 transition-colors"
                            />
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                        </form>


                        <button
                            className="lg:hidden p-2 text-slate-400 hover:text-white transition-colors"
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-expanded={menuOpen}
                            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        >
                            {menuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
            </div>

            <div className={`lg:hidden overflow-hidden transition-all duration-300 ${menuOpen ? 'max-h-96 border-t border-white/10' : 'max-h-0'}`}>
                <nav aria-label="Sections" className="px-6 py-4 flex flex-col gap-3">
                    {SECTIONS.map((section) => (
                        <NavLink key={section.to} to={section.to} end={section.end} className={linkClass}>
                            {section.label}
                        </NavLink>
                    ))}
                    <form onSubmit={submit} className="pt-2">
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search stories"
                            aria-label="Search stories"
                            className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500/40"
                        />
                    </form>
                </nav>
            </div>
        </header>
    );
};

export default SiteHeader;
