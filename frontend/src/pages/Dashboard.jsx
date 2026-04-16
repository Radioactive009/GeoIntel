import React, { useState, useEffect, useMemo } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import ArticleCard from '../components/ArticleCard';
import MapChart from '../components/MapChart';
import { getArticles, getRiskAnalysis, triggerIngestion } from '../services/api';
import {
    ChevronLeft, ChevronRight, Loader2, AlertCircle, Shield,
    TrendingUp, BarChart3, Globe, Activity, Newspaper,
    Zap, Target, AlertTriangle, Search
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ── Risk helpers ────────────────────────────────────────
const getFlagEmoji = (countryCode) => {
    if (!countryCode || typeof countryCode !== 'string' || countryCode === 'Global') return '🌐';
    const code = countryCode.trim().toUpperCase();
    if (code.length !== 2) return '🌐';
    try {
        return String.fromCodePoint(...code.split('').map(char => 127397 + char.charCodeAt()));
    } catch (e) {
        return '🌐';
    }
};

const getRiskColor = (level) => {
    if (level === 'high') return '#f43f5e'; // rose-500
    if (level === 'medium') return '#f59e0b'; // amber-500
    return '#10b981'; // emerald-500
};

const getRiskGradient = (level) => {
    if (level === 'high') return 'from-rose-500/20 to-transparent';
    if (level === 'medium') return 'from-amber-500/20 to-transparent';
    return 'from-emerald-500/20 to-transparent';
};

const COUNTRY_ALIASES = {
    'united states of america': 'united states',
    usa: 'united states',
    russia: 'russian federation',
    iran: 'iran, islamic republic of',
    'russian federation': 'russia',
    'iran (islamic republic of)': 'iran',
    'dem rep congo': 'congo, the democratic republic of the',
    'central african rep': 'central african republic',
    'dominican rep': 'dominican republic',
    'eq guinea': 'equatorial guinea',
    'falkland is': 'falkland islands (malvinas)',
    'bosnia and herz': 'bosnia and herzegovina',
    laos: "lao people's democratic republic",
    macedonia: 'north macedonia',
    moldova: 'moldova, republic of',
    'north korea': "korea, democratic people's republic of",
    'south korea': 'korea, republic of',
    syria: 'syrian arab republic',
    tanzania: 'tanzania, united republic of',
    turkey: 'türkiye',
    venezuela: 'venezuela, bolivarian republic of',
    vietnam: 'viet nam',
    bolivia: 'bolivia, plurinational state of',
    palestine: 'palestine, state of',
    brunei: 'brunei darussalam',
    'solomon is': 'solomon islands',
    's sudan': 'south sudan',
};

const normalizeCountry = (value) => {
    if (!value) return '';
    const normalized = value
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[().,]/g, '')
        .replace(/\s+/g, ' ');
    const aliased = COUNTRY_ALIASES[normalized] || normalized;
    return aliased
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[().,]/g, '')
        .replace(/\s+/g, ' ');
};

const getArticleCountryName = (article) => article?.country || article?.source?.country?.name || '';

// ── Custom chart tooltip ────────────────────────────────
const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="glass px-4 py-3 rounded-2xl shadow-2xl border border-white/10">
            <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{getFlagEmoji(d.iso_code)}</span>
                <p className="text-white font-bold text-sm tracking-tight">{d.country}</p>
            </div>
            <div className="space-y-1">
                <div className="flex items-center justify-between gap-8 text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider">Risk Level</span>
                    <span className="font-bold uppercase tracking-widest" style={{ color: getRiskColor(d.risk_level) }}>
                        {d.risk_level}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-8 text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider">Score</span>
                    <span className="text-white font-bold tabular-nums">{d.risk_score.toFixed(1)}%</span>
                </div>
            </div>
        </div>
    );
};

const Dashboard = () => {
    const [articles, setArticles] = useState([]);
    const [riskData, setRiskData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const articlesPerPage = 9;

    const fetchArticles = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await getArticles();
            setArticles(res.data || []);
        } catch (err) {
            console.error(err);
            setError('Operational status: Connection to intelligence backend severed.');
        } finally {
            setLoading(false);
        }
    };

    const fetchRiskData = async () => {
        try {
            const res = await getRiskAnalysis();
            setRiskData(res.data || []);
        } catch (err) {
            console.error(err);
        }
    };

    const handleManualRefresh = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Trigger fresh ingestion on backend
            await triggerIngestion();
            // 2. Fetch updated data
            await Promise.all([fetchArticles(), fetchRiskData()]);
        } catch (err) {
            console.error(err);
            setError('Intelligence bypass failed. Critical connection timeout.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchArticles(); fetchRiskData(); }, []);

    // ── Filter out countries with zero articles ──────────
    const activeRiskData = useMemo(() => 
        riskData.filter(r => r.total_articles > 0), 
    [riskData]);

    const countries = useMemo(() => {
        const s = new Set();
        articles.forEach(a => {
            const countryName = getArticleCountryName(a);
            if (countryName) s.add(countryName);
        });
        return Array.from(s).sort();
    }, [articles]);

    const regions = useMemo(() => {
        const s = new Set();
        articles.forEach(a => { if (a.source?.country?.region) s.add(a.source.country.region); });
        return Array.from(s).sort();
    }, [articles]);

    const filteredArticles = useMemo(() => {
        return articles.filter(a => {
            const articleCountry = getArticleCountryName(a);
            const cm = !selectedCountry || normalizeCountry(articleCountry) === normalizeCountry(selectedCountry);
            const rm = !selectedRegion || a.source?.country?.region === selectedRegion;
            return cm && rm;
        });
    }, [articles, selectedCountry, selectedRegion]);

    const totalPages = Math.ceil(filteredArticles.length / articlesPerPage);
    const idxFirst = (currentPage - 1) * articlesPerPage;
    const currentArticles = filteredArticles.slice(idxFirst, idxFirst + articlesPerPage);

    const resetFilters = () => { setSelectedCountry(''); setSelectedRegion(''); setCurrentPage(1); };
    useEffect(() => { setCurrentPage(1); }, [selectedCountry, selectedRegion]);

    const highRiskCount = activeRiskData.filter(r => r.risk_level === 'high').length;
    const avgRisk = activeRiskData.length > 0 ? (activeRiskData.reduce((s, r) => s + r.risk_score, 0) / activeRiskData.length).toFixed(1) : '0.0';

    return (
        <div className="flex flex-col min-h-screen app-bg text-slate-400 font-sans">
            <Navbar onRefresh={handleManualRefresh} isRefreshing={loading} />

            <main className="flex-grow max-w-[1440px] mx-auto w-full px-6 py-10 lg:py-12">
                {/* Dashboard Header */}
                <header className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6 animate-fade-in">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Target size={18} className="text-cyan-400" />
                            <span className="text-[10px] font-extrabold uppercase tracking-[0.4em] text-cyan-400/60">Node Active • Sector 07</span>
                        </div>
                        <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
                            Geopolitical <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 decoration-cyan-500/20 underline underline-offset-8">Intelligence</span>
                        </h1>
                        <p className="text-slate-500 text-sm font-medium pt-2">Global monitoring network analyzing {articles.length} reports across {activeRiskData.length} strategic zones.</p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="glass px-4 py-2 rounded-2xl flex items-center gap-3 border border-emerald-500/20">
                            <Activity size={16} className="text-emerald-400" />
                            <div className="leading-tight">
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Global Status</p>
                                <p className="text-xs font-bold text-emerald-400">STABLE</p>
                            </div>
                        </div>
                    </div>
                </header>

                {/* ── SECTION 1: STAT CARDS ────────────────── */}
                <section className="mb-12">
                    <MapChart
                        riskData={activeRiskData}
                        selectedCountry={selectedCountry}
                        onCountrySelect={setSelectedCountry}
                    />
                </section>

                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {[
                        { icon: Globe, label: 'Monitored Regions', value: activeRiskData.length, color: 'text-cyan-400', sub: 'Active Strategic Zones' },
                        { icon: Activity, label: 'Average Risk Score', value: `${avgRisk}%`, color: 'text-amber-400', sub: 'Weighted Regional Index' },
                        { icon: AlertTriangle, label: 'High Alert Zones', value: highRiskCount, color: 'text-rose-400', sub: 'Immediate Threat Potential' },
                        { icon: Newspaper, label: 'Intelligence Volume', value: articles.length, color: 'text-indigo-400', sub: 'Verified Field Reports' },
                    ].map(({ icon: Icon, label, value, color, sub }, i) => (
                        <div
                            key={label}
                            className="glass rounded-3xl p-6 hover:border-cyan-500/30 transition-all duration-300 relative overflow-hidden group animate-fade-in-up"
                            style={{ animationDelay: `${i * 100}ms` }}
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <Icon size={80} />
                            </div>
                            <div className="relative z-10 space-y-4">
                                <div className={`p-2.5 rounded-xl bg-white/5 border border-white/5 w-fit ${color}`}>
                                    <Icon size={18} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-[0.2em] mb-1">{label}</p>
                                    <p className="text-3xl font-extrabold text-white tracking-tight tabular-nums">{value}</p>
                                    <p className="text-[10px] font-medium text-slate-600 mt-2 uppercase tracking-wide">{sub}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>

                {/* ── SECTION 2: ANALYTICS ──────────────────── */}
                <section className="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-12 items-stretch">
                    {/* Bar Chart Container */}
                    <div className="xl:col-span-2 glass rounded-[2.5rem] p-8 lg:p-10 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                                    <BarChart3 size={18} className="text-cyan-400" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">Regional Risk Matrix</h2>
                            </div>
                        </div>
                        <div className="h-[320px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={activeRiskData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                                    <XAxis
                                        dataKey="iso_code"
                                        tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }}
                                        axisLine={false}
                                        tickLine={false}
                                        dy={10}
                                    />
                                    <YAxis
                                        tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                                        axisLine={false}
                                        tickLine={false}
                                        domain={[0, 100]}
                                        tickFormatter={(v) => `${v}%`}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                    <Bar dataKey="risk_score" radius={[12, 12, 12, 12]} barSize={50}>
                                        {activeRiskData.map((e) => (
                                            <Cell key={e.iso_code} fill={getRiskColor(e.risk_level)} fillOpacity={0.9} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Threat Ranking Container */}
                    <div className="glass rounded-[2.5rem] p-8 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                <Zap size={18} className="text-indigo-400" />
                            </div>
                            <h2 className="text-base font-bold text-white uppercase tracking-widest">Threat Index</h2>
                        </div>
                        <div className="space-y-4">
                            {activeRiskData.slice(0, 5).map((item, i) => (
                                <div
                                    key={item.iso_code}
                                    className="flex items-center gap-4 p-4 rounded-3xl bg-slate-900/40 border border-white/5 transition-transform duration-300 hover:translate-x-1"
                                >
                                    <span className="text-xs font-bold text-slate-600 tabular-nums w-4">0{i + 1}</span>
                                    <div className="text-2xl leading-none">{getFlagEmoji(item.iso_code)}</div>
                                    <div className="flex-grow min-w-0">
                                        <p className="text-sm font-bold text-white truncate">{item.country}</p>
                                        <div className="flex items-center gap-2 mt-1.5">
                                            <div className="flex-grow h-1 rounded-full bg-slate-800/60 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-1000 ease-out"
                                                    style={{ width: `${item.risk_score}%`, background: getRiskColor(item.risk_level) }}
                                                />
                                            </div>
                                            <span className="text-[11px] font-bold tabular-nums" style={{ color: getRiskColor(item.risk_level) }}>
                                                {item.risk_score.toFixed(0)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── SECTION 3: INTELLIGENCE FEED ─────────── */}
                <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
                    <Sidebar
                        countries={countries}
                        regions={regions}
                        selectedCountry={selectedCountry}
                        selectedRegion={selectedRegion}
                        onCountryChange={setSelectedCountry}
                        onRegionChange={setSelectedRegion}
                        onReset={resetFilters}
                    />

                    <div className="flex-grow space-y-8 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
                        {/* Feed Header */}
                        <div className="flex items-center justify-between px-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-cyan-500/10">
                                    <Search size={18} className="text-cyan-400" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest">
                                    {selectedCountry ? `News for ${selectedCountry}` : 'Global News'}
                                </h2>
                            </div>
                            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest tabular-nums">
                                {filteredArticles.length} Bulletins Logged
                            </p>
                        </div>

                        {loading ? (
                            <div className="py-32 flex flex-col items-center justify-center glass rounded-[2.5rem] border border-white/5">
                                <Loader2 className="text-cyan-400 animate-spin mb-6" size={48} />
                                <p className="text-slate-400 font-bold uppercase tracking-[0.3em] text-[10px]">Processing Satellite Feeds...</p>
                            </div>
                        ) : error ? (
                            <div className="py-32 flex flex-col items-center justify-center glass rounded-[2.5rem] border border-rose-500/20 text-center px-10">
                                <AlertCircle className="text-rose-500 mb-6 animate-pulse" size={56} />
                                <h3 className="text-white font-bold text-xl mb-3">Operational Interruption</h3>
                                <p className="text-slate-500 text-sm max-w-md font-medium leading-relaxed mb-8">{error}</p>
                                <button onClick={fetchArticles} className="btn-primary">Reconnect Network</button>
                            </div>
                        ) : (
                            <div className="space-y-10">
                                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                                    {currentArticles.length > 0 ? (
                                        currentArticles.map((article, i) => (
                                            <ArticleCard key={article.id || i} article={article} index={i} />
                                        ))
                                    ) : (
                                        <div className="col-span-full py-32 text-center glass rounded-[2.5rem]">
                                            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No intelligence data matches current coordinate filters.</p>
                                        </div>
                                    )}
                                </div>

                                {/* Modern Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between py-8 border-t border-white/5">
                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest tabular-nums">
                                            Scanning bulletins <span className="text-white mx-1">{idxFirst + 1}</span>—<span className="text-white mx-1">{Math.min(idxFirst + articlesPerPage, filteredArticles.length)}</span>
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                                                disabled={currentPage === 1}
                                                className="p-3 rounded-2xl glass hover:border-cyan-500/40 disabled:opacity-20 transition-all text-white active:scale-95"
                                            >
                                                <ChevronLeft size={20} />
                                            </button>
                                            <div className="flex items-center gap-1.5 px-3">
                                                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(page => (
                                                    <button
                                                        key={page}
                                                        onClick={() => setCurrentPage(page)}
                                                        className={`w-10 h-10 rounded-2xl text-xs font-bold transition-all ${currentPage === page
                                                            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-500/30 scale-110'
                                                            : 'text-slate-500 hover:bg-white/5 hover:text-white'
                                                            }`}
                                                    >
                                                        {page}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                                                disabled={currentPage === totalPages}
                                                className="p-3 rounded-2xl glass hover:border-cyan-500/40 disabled:opacity-20 transition-all text-white active:scale-95"
                                            >
                                                <ChevronRight size={20} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <footer className="mt-auto border-t border-slate-800/50 py-10 px-6 text-center space-y-4">
                <div className="max-w-2xl mx-auto glass p-6 rounded-[2rem] border border-indigo-500/10">
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed italic">
                        <span className="text-indigo-400 font-bold uppercase tracking-widest mr-2">Intelligence Note:</span>
                        This system is currently built on basic NLP pipelines. Geopolitical nuance is complex, so do not expect sentiment analysis to be 100% accurate. 
                        If you think you can build a more accurate sentiment engine for geopolitical data—do it! Take it as a fun challenge.
                    </p>
                </div>
                <p className="text-[10px] text-slate-600 uppercase tracking-[0.25em] font-bold">
                    GeoIntel Systems • Multi-Source Intelligence • Secure Node 04
                </p>
            </footer>
        </div>
    );
};

export default Dashboard;
