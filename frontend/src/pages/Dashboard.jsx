import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import ArticleCard from '../components/ArticleCard';
import MapChart from '../components/MapChart';
import Sparkline from '../components/Sparkline';
import EscalationPanel from '../components/EscalationPanel';
import LiveBroadcast from '../components/LiveBroadcast';
import {
    getArticles, getAlertAnalysis, getStats, getTrends, getMovers, getChannels,
    runIngestion,
} from '../services/api';
import {
    ChevronLeft, ChevronRight, Loader2, AlertCircle, Shield,
    BarChart3, Globe, Activity, Newspaper,
    Zap, Target, AlertTriangle, Search, Mail, Phone, Github
} from 'lucide-react';
import developerImg from '../assets/developer.jpg';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL, matchesCountry } from '../utils/country';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const ARTICLES_PER_PAGE = 9;

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
                    <span className="text-slate-500 font-bold uppercase tracking-wider">Status</span>
                    <span className="font-bold uppercase tracking-widest" style={{ color: getAlertColor(d.alert_status) }}>
                        {ALERT_STATUS_LABEL[d.alert_status] || 'STABLE'}
                    </span>
                </div>
                <div className="flex items-center justify-between gap-8 text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider">Level</span>
                    <span className="text-white font-bold tabular-nums">{d.alert_level.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between gap-8 text-[11px]">
                    <span className="text-slate-500 font-bold uppercase tracking-wider">Reports</span>
                    <span className="text-white font-bold tabular-nums">{d.total_articles}</span>
                </div>
            </div>
        </div>
    );
};

const Dashboard = () => {
    const [articles, setArticles] = useState([]);
    const [totalArticles, setTotalArticles] = useState(0);
    const [alertData, setAlertData] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedLevel, setSelectedLevel] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [chartFilter, setChartFilter] = useState('top');
    const [trendSeries, setTrendSeries] = useState({});
    const [movers, setMovers] = useState(null);
    const [trendWindow, setTrendWindow] = useState(168);
    const [channels, setChannels] = useState([]);
    const [channelsLoading, setChannelsLoading] = useState(true);

    // Reset paging when the filters change — during render, not in an effect.
    // As an effect it ran *after* the fetch effect, so changing a filter while
    // on page 3 fired one request at the old offset and a second at offset 0.
    // Adjusting state here makes React re-render before committing, so only
    // the page-1 request is ever issued.
    const filterKey = `${selectedCountry}|${selectedRegion}|${selectedLevel}`;
    const [lastFilterKey, setLastFilterKey] = useState(filterKey);
    if (filterKey !== lastFilterKey) {
        setLastFilterKey(filterKey);
        setCurrentPage(1);
    }

    // Guards against out-of-order responses: only the newest request may write
    // to state, so a slow early request can no longer overwrite a fast later
    // one and leave the grid showing a page the controls disagree with.
    const requestSeq = useRef(0);

    // Articles are paginated and filtered by the backend; the dashboard used
    // to download every article and slice it in the browser.
    const fetchArticles = useCallback(async () => {
        const seq = ++requestSeq.current;
        setLoading(true);
        setError(null);
        try {
            const res = await getArticles({
                country: selectedCountry,
                region: selectedRegion,
                level: selectedLevel,
                limit: ARTICLES_PER_PAGE,
                offset: (currentPage - 1) * ARTICLES_PER_PAGE,
            });
            if (seq !== requestSeq.current) return;
            setArticles(res.data?.items || []);
            setTotalArticles(res.data?.total || 0);
        } catch (err) {
            if (seq !== requestSeq.current) return;
            console.error(err);
            setArticles([]);
            setTotalArticles(0);
            setError(
                'Operational status: connection to intelligence backend severed. ' +
                'Confirm the API is running and VITE_API_URL points at it.'
            );
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [selectedCountry, selectedRegion, selectedLevel, currentPage]);

    const fetchOverview = useCallback(async () => {
        try {
            const [alertRes, statsRes] = await Promise.all([
                getAlertAnalysis(true),
                getStats().catch(() => null),
            ]);
            setAlertData(alertRes.data || []);
            if (statsRes) setStats(statsRes.data);
        } catch (err) {
            console.error(err);
        }
    }, []);

    // Risk history powers both the ranking sparklines and the escalation board.
    // Failures here must never blank the dashboard — history simply may not
    // exist yet on a freshly seeded instance.
    const fetchTrends = useCallback(async () => {
        try {
            const [trendRes, moverRes] = await Promise.all([
                getTrends({ hours: trendWindow, points: 24 }),
                getMovers({ hours: trendWindow, limit: 5 }),
            ]);
            setTrendSeries(trendRes.data?.series || {});
            setMovers(moverRes.data || null);
        } catch (err) {
            console.error(err);
            setTrendSeries({});
            setMovers(null);
        }
    }, [trendWindow]);

    // Fetched once for every country: the player switches locally on selection,
    // so re-fetching per country would restart the stream on every click.
    const fetchChannels = useCallback(async () => {
        setChannelsLoading(true);
        try {
            const res = await getChannels();
            setChannels(res.data?.channels || []);
        } catch (err) {
            console.error(err);
            setChannels([]);
        } finally {
            setChannelsLoading(false);
        }
    }, []);

    useEffect(() => { fetchArticles(); }, [fetchArticles]);
    useEffect(() => { fetchOverview(); }, [fetchOverview]);
    useEffect(() => { fetchTrends(); }, [fetchTrends]);
    useEffect(() => { fetchChannels(); }, [fetchChannels]);

    const handleManualRefresh = async () => {
        setRefreshing(true);
        setError(null);
        try {
            // Ingestion now runs in the background on the server and this
            // polls for completion, instead of holding one request open for
            // minutes past the gateway timeout.
            await runIngestion(10);
            await Promise.all([fetchArticles(), fetchOverview(), fetchTrends(), fetchChannels()]);
        } catch (err) {
            console.error(err);
            setError('Intelligence sync failed. The ingestion cycle errored or the backend is unreachable.');
        } finally {
            setRefreshing(false);
        }
    };

    const activeAlertData = useMemo(
        () => alertData.filter((r) => r.total_articles > 0),
        [alertData]
    );

    const filteredChartData = useMemo(() => {
        if (chartFilter === 'top') return activeAlertData.slice(0, 15);
        if (chartFilter === 'critical') return activeAlertData.filter((d) => d.alert_status === 'high');
        if (chartFilter === 'elevated') return activeAlertData.filter((d) => d.alert_status === 'medium');
        if (chartFilter === 'stable') return activeAlertData.filter((d) => d.alert_status === 'low');
        return activeAlertData;
    }, [activeAlertData, chartFilter]);

    // Filter options come from the alert scan, which covers every country that
    // has articles — not just the ones on the current page.
    const countries = useMemo(
        () => activeAlertData.map((r) => r.country).filter(Boolean).sort(),
        [activeAlertData]
    );

    const regions = useMemo(
        () => Array.from(new Set(activeAlertData.map((r) => r.region).filter(Boolean))).sort(),
        [activeAlertData]
    );

    const totalPages = Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
    const idxFirst = (currentPage - 1) * ARTICLES_PER_PAGE;

    const resetFilters = () => {
        setSelectedCountry('');
        setSelectedRegion('');
        setSelectedLevel('');
        setCurrentPage(1);
    };

    const criticalCount = activeAlertData.filter((r) => r.alert_status === 'high').length;
    const avgAlert = activeAlertData.length > 0
        ? (activeAlertData.reduce((s, r) => s + r.alert_level, 0) / activeAlertData.length).toFixed(1)
        : '0.0';
    const totalReports = stats?.total_articles ?? totalArticles;

    // Page window that follows the current page instead of always showing 1-5.
    const pageWindow = useMemo(() => {
        const span = Math.min(5, totalPages);
        let start = Math.max(1, currentPage - Math.floor(span / 2));
        if (start + span - 1 > totalPages) start = Math.max(1, totalPages - span + 1);
        return Array.from({ length: span }, (_, i) => start + i);
    }, [currentPage, totalPages]);

    return (
        <div className="flex flex-col min-h-screen app-bg text-slate-400 font-sans">
            <Navbar onRefresh={handleManualRefresh} isRefreshing={refreshing} />

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
                        <p className="text-slate-500 text-sm font-medium pt-2">
                            Global monitoring network analyzing {totalReports} reports across {activeAlertData.length} strategic zones.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="glass px-4 py-2 rounded-2xl flex items-center gap-3 border border-emerald-500/20">
                            <Activity size={16} className="text-emerald-400" />
                            <div className="leading-tight">
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">System Status</p>
                                <p className="text-xs font-bold text-emerald-400">
                                    {error ? 'DEGRADED' : 'OPERATIONAL'}
                                </p>
                            </div>
                        </div>
                    </div>
                </header>

                {/* ── SECTION 1: MAP + LIVE BROADCAST ────────
                    `relative z-30` is load-bearing: every section below uses
                    animate-fade-in-up, and a transform creates a stacking
                    context, so without an explicit z-index here the channel
                    dropdown would paint underneath the stat cards. */}
                <section className="relative z-30 grid grid-cols-1 xl:grid-cols-5 gap-8 mb-12 items-start">
                    <div className="xl:col-span-3">
                        <MapChart
                            alertData={activeAlertData}
                            selectedCountry={selectedCountry}
                            onCountrySelect={setSelectedCountry}
                            heightClass="h-[340px] md:h-[440px] xl:h-[500px]"
                        />
                    </div>
                    <div className="xl:col-span-2">
                        <LiveBroadcast
                            channels={channels}
                            selectedCountry={selectedCountry}
                            loading={channelsLoading}
                        />
                    </div>
                </section>

                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    {[
                        { icon: Globe, label: 'Strategic Zones', value: activeAlertData.length, color: 'text-cyan-400', sub: 'Active Monitoring Nodes' },
                        { icon: Activity, label: 'Alert Level Index', value: `${avgAlert}%`, color: 'text-amber-400', sub: 'Global Stability Metric' },
                        { icon: AlertTriangle, label: 'Critical Status Zones', value: criticalCount, color: 'text-rose-400', sub: 'Immediate Response Required' },
                        { icon: Newspaper, label: 'Intelligence Volume', value: totalReports, color: 'text-indigo-400', sub: 'Verified Field Reports' },
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
                    <div className="xl:col-span-2 glass rounded-[2.5rem] p-8 lg:p-10 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                                    <BarChart3 size={18} className="text-cyan-400" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">Regional Alert Matrix</h2>
                            </div>

                            <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5 gap-1">
                                {[
                                    { id: 'top', label: 'Top 15' },
                                    { id: 'critical', label: 'Critical' },
                                    { id: 'elevated', label: 'Elevated' },
                                    { id: 'stable', label: 'Stable' },
                                    { id: 'all', label: 'All' }
                                ].map(f => (
                                    <button
                                        key={f.id}
                                        onClick={() => setChartFilter(f.id)}
                                        className={`px-3 py-1 rounded-lg text-[9px] font-bold transition-all whitespace-nowrap ${
                                            chartFilter === f.id
                                                ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                                                : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="h-[350px] w-full min-h-[350px] overflow-x-auto chart-scrollbar pb-4">
                            {filteredChartData.length === 0 ? (
                                <div className="h-full flex items-center justify-center">
                                    <p className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">No zones match this filter</p>
                                </div>
                            ) : (
                                <div style={{
                                    minWidth: chartFilter === 'all' ? `${filteredChartData.length * 45}px` : '100%',
                                    height: '100%'
                                }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={filteredChartData} margin={{ top: 10, right: 10, bottom: 40, left: -20 }}>
                                            <XAxis
                                                dataKey="iso_code"
                                                tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }}
                                                axisLine={false}
                                                tickLine={false}
                                                dy={15}
                                                interval={0}
                                                angle={-45}
                                                textAnchor="end"
                                            />
                                            <YAxis
                                                tick={{ fill: '#475569', fontSize: 11, fontWeight: 600 }}
                                                axisLine={false}
                                                tickLine={false}
                                                domain={[0, 100]}
                                                tickFormatter={(v) => `${v}%`}
                                            />
                                            <Tooltip
                                                content={<CustomTooltip />}
                                                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                                                animationDuration={300}
                                            />
                                            <Bar
                                                dataKey="alert_level"
                                                radius={[6, 6, 6, 6]}
                                                barSize={chartFilter === 'all' ? 18 : 40}
                                                onClick={(d) => setSelectedCountry(d?.country || '')}
                                                className="cursor-pointer"
                                            >
                                                {filteredChartData.map((e) => (
                                                    <Cell key={e.iso_code} fill={getAlertColor(e.alert_status)} fillOpacity={0.9} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="glass rounded-[2.5rem] p-8 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                <Zap size={18} className="text-indigo-400" />
                            </div>
                            <h2 className="text-base font-bold text-white uppercase tracking-widest">Alert Ranking</h2>
                        </div>
                        <div className="space-y-4">
                            {activeAlertData.length === 0 && (
                                <p className="text-slate-600 text-xs font-bold uppercase tracking-widest">Awaiting first intelligence cycle</p>
                            )}
                            {activeAlertData.slice(0, 5).map((item, i) => (
                                <button
                                    key={item.iso_code}
                                    onClick={() => setSelectedCountry(item.country)}
                                    className="w-full text-left flex items-center gap-3 p-4 rounded-3xl bg-slate-900/40 border border-white/5 transition-transform duration-300 hover:translate-x-1"
                                >
                                    <span className="text-xs font-bold text-slate-600 tabular-nums w-4">0{i + 1}</span>
                                    <div className="text-2xl leading-none">{getFlagEmoji(item.iso_code)}</div>
                                    <div className="flex-grow min-w-0">
                                        <p className="text-sm font-bold text-white truncate">{item.country}</p>
                                        <div className="flex items-center gap-2 mt-1.5">
                                            <div className="flex-grow h-1 rounded-full bg-slate-800/60 overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all duration-1000 ease-out"
                                                    style={{ width: `${item.alert_level}%`, background: getAlertColor(item.alert_status) }}
                                                />
                                            </div>
                                            <span className="text-[11px] font-bold tabular-nums" style={{ color: getAlertColor(item.alert_status) }}>
                                                {item.alert_level.toFixed(0)}%
                                            </span>
                                        </div>
                                    </div>
                                    <Sparkline
                                        points={trendSeries[item.iso_code]}
                                        color={getAlertColor(item.alert_status)}
                                        width={58}
                                        height={24}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ── SECTION 2b: ESCALATION ────────────────── */}
                <section className="mb-12">
                    <EscalationPanel
                        movers={movers}
                        series={trendSeries}
                        windowHours={trendWindow}
                        onWindowChange={setTrendWindow}
                        onSelect={setSelectedCountry}
                    />
                </section>

                {/* ── SECTION 3: INTELLIGENCE FEED ─────────── */}
                <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
                    <Sidebar
                        countries={countries}
                        regions={regions}
                        selectedCountry={selectedCountry}
                        selectedRegion={selectedRegion}
                        selectedLevel={selectedLevel}
                        onCountryChange={setSelectedCountry}
                        onRegionChange={setSelectedRegion}
                        onLevelChange={setSelectedLevel}
                        onReset={resetFilters}
                        stats={stats}
                    />

                    <div className="flex-grow space-y-8 animate-fade-in-up" style={{ animationDelay: '600ms' }}>
                        {/* Feed Header */}
                        <div className="flex items-center justify-between px-2 flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-cyan-500/10">
                                    <Search size={18} className="text-cyan-400" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest">
                                    {selectedCountry ? `Satellite Feed: ${selectedCountry}` : 'Global Intelligence Feed'}
                                </h2>
                            </div>
                            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest tabular-nums">
                                {totalArticles} Reports Logged
                            </p>
                        </div>

                        {loading ? (
                            <div className="py-32 flex flex-col items-center justify-center glass rounded-[2.5rem] border border-white/5">
                                <Loader2 className="text-cyan-400 animate-spin mb-6" size={48} />
                                <p className="text-slate-400 font-bold uppercase tracking-[0.3em] text-[10px]">Filtering Intelligence Stream...</p>
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
                                    {articles.length > 0 ? (
                                        articles.map((article, i) => (
                                            <ArticleCard key={article.id || i} article={article} index={i} />
                                        ))
                                    ) : (
                                        <div className="col-span-full py-32 text-center glass rounded-[2.5rem]">
                                            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">
                                                No intelligence data matches current coordinate filters.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-between py-8 border-t border-white/5 flex-wrap gap-4">
                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest tabular-nums">
                                            Scanning bulletins <span className="text-white mx-1">{idxFirst + 1}</span>—
                                            <span className="text-white mx-1">{Math.min(idxFirst + ARTICLES_PER_PAGE, totalArticles)}</span>
                                            {' of '}<span className="text-white mx-1">{totalArticles}</span>
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                                                disabled={currentPage === 1}
                                                className="p-3 rounded-2xl glass hover:border-cyan-500/40 disabled:opacity-20 transition-all text-white active:scale-95"
                                                aria-label="Previous page"
                                            >
                                                <ChevronLeft size={20} />
                                            </button>
                                            <div className="flex items-center gap-1.5 px-3">
                                                {pageWindow.map(page => (
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
                                                aria-label="Next page"
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

            <footer className="mt-auto border-t border-slate-800/50 py-16 px-6 text-center space-y-12">
                <div className="max-w-5xl mx-auto flex flex-col xl:flex-row items-center gap-8">
                    {/* Developer Card */}
                    <div className="flex-grow glass p-8 rounded-[2.5rem] border border-white/5 flex flex-col sm:flex-row items-center gap-8 text-center sm:text-left transition-all duration-500 hover:border-cyan-500/30 group">
                        <div className="relative shrink-0">
                            <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500 to-indigo-500 rounded-[2rem] blur-xl opacity-20 group-hover:opacity-40 transition duration-1000"></div>
                            <img
                                src={developerImg}
                                alt="Kislay Kumar"
                                className="relative w-32 h-32 rounded-[1.5rem] object-cover border border-white/10 shadow-2xl"
                            />
                        </div>
                        <div className="space-y-5">
                            <div className="space-y-1">
                                <div className="flex items-center justify-center sm:justify-start gap-2 mb-1">
                                    <Shield size={12} className="text-cyan-400" />
                                    <p className="text-[10px] font-extrabold text-cyan-400 uppercase tracking-[0.4em]">Project Developer</p>
                                </div>
                                <h3 className="text-3xl font-black text-white tracking-tight">Kislay Kumar</h3>
                            </div>
                            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:gap-6">
                                <a href="mailto:kislaykumar20092002@gmail.com" className="flex items-center justify-center sm:justify-start gap-3 text-slate-400 hover:text-cyan-400 transition-all duration-300 transform hover:translate-x-1">
                                    <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                                        <Mail size={14} className="text-cyan-400" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">kislaykumar20092002@gmail.com</span>
                                </a>
                                <a href="tel:+918434460542" className="flex items-center justify-center sm:justify-start gap-3 text-slate-400 hover:text-cyan-400 transition-all duration-300 transform hover:translate-x-1">
                                    <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                                        <Phone size={14} className="text-cyan-400" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">+91 8434460542</span>
                                </a>
                                <a href="https://github.com/Radioactive009/GeoIntel" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center sm:justify-start gap-3 text-slate-400 hover:text-cyan-400 transition-all duration-300 transform hover:translate-x-1">
                                    <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                                        <Github size={14} className="text-cyan-400" />
                                    </div>
                                    <span className="text-xs font-bold uppercase tracking-wider">GitHub Repo</span>
                                </a>
                            </div>
                        </div>
                    </div>

                    {/* Intelligence Note */}
                    <div className="xl:w-1/3 glass p-8 rounded-[2.5rem] border border-white/5 flex flex-col justify-center gap-4 text-left">
                        <div className="flex items-center gap-2 mb-1">
                            <Activity size={14} className="text-indigo-400" />
                            <span className="text-indigo-400 font-extrabold uppercase tracking-widest text-[10px]">Intelligence Note</span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium leading-relaxed italic">
                            Alert statuses are generated via automated keyword and sentiment analysis, and countries are
                            resolved from article text. Geopolitical nuance is complex — treat these metrics as
                            intelligence signals rather than absolute truth.
                        </p>
                    </div>
                </div>

                <div className="pt-10 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 px-4">
                    <p className="text-[10px] text-slate-600 uppercase tracking-[0.4em] font-bold">
                        GeoIntel Systems • Strategic Monitoring • Hub 07
                    </p>
                    <div className="flex items-center gap-4">
                        <div className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-rose-500' : 'bg-emerald-500'} animate-pulse`}></div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            Secure Node Connection Active • {new Date().getFullYear()}
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Dashboard;
