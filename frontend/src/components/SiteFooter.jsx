import { Link } from 'react-router-dom';
import { Rss, Github } from 'lucide-react';
import { API_URL } from '../services/api';

/**
 * Site footer.
 *
 * Deliberately carries no personal contact details. A public page listing a
 * personal phone number and inbox is scraped within days, and on a product
 * that presents itself as a publication it reads as a hobby project. Contact
 * belongs behind /about.
 */
const SiteFooter = () => (
    <footer className="mt-auto border-t border-white/10 bg-background">
        <div className="max-w-[1440px] mx-auto px-6 py-12">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
                <div className="col-span-2 md:col-span-1">
                    <p className="font-display text-lg font-extrabold text-white tracking-tight">GeoIntel</p>
                    <p className="text-[13px] text-slate-500 leading-relaxed mt-2 max-w-xs">
                        Geopolitical news from international wire services, attributed to a country
                        and scored for risk.
                    </p>
                </div>

                <nav aria-label="Sections">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">Sections</h2>
                    <ul className="space-y-2 text-[13px]">
                        {[
                            ['/events', 'Major events'],
                            ['/topic/conflict', 'Conflict'],
                            ['/topic/security', 'Security'],
                            ['/topic/diplomacy', 'Diplomacy'],
                            ['/topic/economy', 'Economy'],
                            ['/topic/politics', 'Politics'],
                            ['/topic/disaster', 'Disasters'],
                            ['/topic/humanitarian', 'Humanitarian'],
                        ].map(([to, label]) => (
                            <li key={to}>
                                <Link to={to} className="text-slate-400 hover:text-cyan-400 transition-colors">{label}</Link>
                            </li>
                        ))}
                    </ul>
                </nav>

                <nav aria-label="Study">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">Study</h2>
                    <ul className="space-y-2 text-[13px]">
                        {[
                            ['/study', 'Revision compilation'],
                            ['/india', 'India & the world'],
                            ['/glossary', 'Groupings & institutions'],
                            ['/notes', 'Saved stories'],
                            ['/ask', 'Ask the archive'],
                        ].map(([to, label]) => (
                            <li key={to}>
                                <Link to={to} className="text-slate-400 hover:text-cyan-400 transition-colors">{label}</Link>
                            </li>
                        ))}
                    </ul>
                </nav>

                <nav aria-label="About this site">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">About</h2>
                    <ul className="space-y-2 text-[13px]">
                        <li><Link to="/about" className="text-slate-400 hover:text-cyan-400 transition-colors">About us</Link></li>
                        <li><Link to="/methodology" className="text-slate-400 hover:text-cyan-400 transition-colors">Methodology</Link></li>
                        <li><Link to="/sources" className="text-slate-400 hover:text-cyan-400 transition-colors">Sources</Link></li>
                    </ul>
                </nav>

                <div>
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-3">Follow</h2>
                    <ul className="space-y-2 text-[13px]">
                        <li>
                            <a
                                href={`${API_URL}/feed.xml`}
                                className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors"
                            >
                                <Rss size={13} /> RSS feed
                            </a>
                        </li>
                        <li>
                            <a
                                href="https://github.com/Radioactive009/GeoIntel"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 text-slate-400 hover:text-cyan-400 transition-colors"
                            >
                                <Github size={13} /> Source code
                            </a>
                        </li>
                    </ul>
                </div>
            </div>

            <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-xs text-slate-600">
                    © {new Date().getFullYear()} GeoIntel. Headlines and images belong to their publishers.
                </p>
                <p className="text-xs text-slate-600 max-w-md sm:text-right">
                    Risk levels are produced automatically. Treat them as a signal, not a verdict.
                </p>
            </div>
        </div>
    </footer>
);

export default SiteFooter;
