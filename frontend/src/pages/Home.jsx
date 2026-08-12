import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import Sidebar from '../components/Sidebar';
import { LeadStory, SecondaryStory, StoryCard } from '../components/StoryCards';
import { LeadStorySkeleton, StoryGridSkeleton } from '../components/Skeleton';
import Seo from '../components/Seo';

// Recharts is the largest single dependency and this section sits below the
// fold, so it is fetched only once the reader gets there.
const RiskByCountryChart = lazy(() => import('../components/RiskByCountryChart'));
import MapChart from '../components/MapChart';
import Sparkline from '../components/Sparkline';
import EscalationPanel from '../components/EscalationPanel';
import LiveBroadcast from '../components/LiveBroadcast';
import CountryPanel from '../components/CountryPanel';
import RelationsPanel from '../components/RelationsPanel';
import TimeScrubber from '../components/TimeScrubber';
import useWatchlist from '../hooks/useWatchlist';
import {
    getArticles, getAlertAnalysis, getStats, getTrends, getMovers, getChannels,
    getRelations, getHistoryFrames,
} from '../services/api';
import {
    ChevronLeft, ChevronRight, AlertCircle, BarChart3, Globe, Activity,
    Newspaper, Zap, Target, AlertTriangle, Search, Star, Bell, BellOff,
} from 'lucide-react';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL, matchesCountry } from '../utils/country';


const ARTICLES_PER_PAGE = 9;

const Home = () => {
    const [articles, setArticles] = useState([]);
    const [totalArticles, setTotalArticles] = useState(0);
    const [alertData, setAlertData] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedLevel, setSelectedLevel] = useState('');
    const [selectedEventType, setSelectedEventType] = useState('');
    const [selectedDays, setSelectedDays] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [chartFilter, setChartFilter] = useState('top');
    const [trendSeries, setTrendSeries] = useState({});
    const [movers, setMovers] = useState(null);
    const [trendWindow, setTrendWindow] = useState(168);
    const [channels, setChannels] = useState([]);
    const [channelsLoading, setChannelsLoading] = useState(true);
    const [countryArticles, setCountryArticles] = useState([]);
    const [countryArticlesLoading, setCountryArticlesLoading] = useState(false);
    const [relations, setRelations] = useState([]);
    const [frames, setFrames] = useState([]);
    const [frameIndex, setFrameIndex] = useState(0);
    const [replaying, setReplaying] = useState(false);
    const feedRef = useRef(null);

    const { watched, isWatched, toggle: toggleWatch, permission, requestPermission, notifyEscalations } =
        useWatchlist();

    // Reset paging when the filters change — during render, not in an effect.
    // As an effect it ran *after* the fetch effect, so changing a filter while
    // on page 3 fired one request at the old offset and a second at offset 0.
    // Adjusting state here makes React re-render before committing, so only
    // the page-1 request is ever issued.
    const filterKey = [
        selectedCountry, selectedRegion, selectedLevel, selectedEventType, selectedDays, searchTerm,
    ].join('|');
    const hasActiveFilters = filterKey !== '|||||';
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
                eventType: selectedEventType,
                days: selectedDays,
                q: searchTerm,
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
                'Could not reach the newsroom service. Check that the API is running '
                + 'and VITE_API_URL points at it.'
            );
        } finally {
            if (seq === requestSeq.current) setLoading(false);
        }
    }, [selectedCountry, selectedRegion, selectedLevel, selectedEventType, selectedDays, searchTerm, currentPage]);

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
            const [trendRes, moverRes, relationRes, frameRes] = await Promise.all([
                getTrends({ hours: trendWindow, points: 24 }),
                getMovers({ hours: trendWindow, limit: 5 }),
                getRelations({ hours: trendWindow, limit: 10 }).catch(() => null),
                getHistoryFrames({ hours: trendWindow, frames: 36 }).catch(() => null),
            ]);
            setTrendSeries(trendRes.data?.series || {});
            setMovers(moverRes.data || null);
            setRelations(relationRes?.data?.pairs || []);

            const nextFrames = frameRes?.data?.frames || [];
            setFrames(nextFrames);
            // Land on the present, not on the oldest frame.
            setFrameIndex(Math.max(0, nextFrames.length - 1));
            setReplaying(false);

            // The escalation scan already ran server-side; this only decides
            // which of its findings the viewer asked to be told about.
            notifyEscalations(moverRes.data?.rising || []);
        } catch (err) {
            console.error(err);
            setTrendSeries({});
            setMovers(null);
        }
    }, [trendWindow, notifyEscalations]);

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

    // Headlines for the dossier. Fetched separately from the main feed rather
    // than reusing its page: the feed is paginated, so once the viewer moved
    // to page 3 the panel would have shown page 3 of that country.
    useEffect(() => {
        if (!selectedCountry) {
            setCountryArticles([]);
            return undefined;
        }
        let cancelled = false;
        setCountryArticlesLoading(true);
        getArticles({ country: selectedCountry, limit: 5 })
            .then((res) => { if (!cancelled) setCountryArticles(res.data?.items || []); })
            .catch(() => { if (!cancelled) setCountryArticles([]); })
            .finally(() => { if (!cancelled) setCountryArticlesLoading(false); });
        return () => { cancelled = true; };
    }, [selectedCountry]);

    useEffect(() => { fetchArticles(); }, [fetchArticles]);
    useEffect(() => { fetchOverview(); }, [fetchOverview]);
    useEffect(() => { fetchTrends(); }, [fetchTrends]);
    useEffect(() => { fetchChannels(); }, [fetchChannels]);




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

    // selectedCountry may hold an ISO code (map click) or a name (sidebar).
    // The backend accepts either; this is purely what the viewer reads.
    const selectedRecord = useMemo(() => {
        if (!selectedCountry) return null;
        return activeAlertData.find((r) =>
            matchesCountry(selectedCountry, { name: r.country, iso: r.iso_code })
        ) || null;
    }, [activeAlertData, selectedCountry]);

    const selectedLabel = selectedRecord?.country || selectedCountry;

    // A country with no articles has no alert row, so fall back to the raw
    // selection when it already is an ISO code.
    const selectedIso = selectedRecord?.iso_code
        || (selectedCountry.length === 2 ? selectedCountry.toUpperCase() : '');

    const selectedChannel = useMemo(
        () => channels.find((c) =>
            c.is_live && matchesCountry(selectedCountry, { name: c.country, iso: c.country_iso_code })
        ) || null,
        [channels, selectedCountry]
    );

    // The lead treatment is for the unfiltered front page only. Once the
    // reader has filtered or paged, promoting one story asserts an editorial
    // judgement that no longer holds.
    const isFrontPage = currentPage === 1 && !hasActiveFilters && articles.length >= 3;
    const [leadStory, ...restStories] = articles;
    const secondaryStories = isFrontPage ? restStories.slice(0, 2) : [];
    const riverStories = isFrontPage ? restStories.slice(2) : [];

    const totalPages = Math.max(1, Math.ceil(totalArticles / ARTICLES_PER_PAGE));
    const idxFirst = (currentPage - 1) * ARTICLES_PER_PAGE;

    // A shrinking result set can strand the viewer past the last page.
    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    const resetFilters = () => {
        setSelectedCountry('');
        setSelectedRegion('');
        setSelectedLevel('');
        setSelectedEventType('');
        setSelectedDays(0);
        setSearchTerm('');
        setCurrentPage(1);
    };

    // While scrubbing, the map is coloured from the recorded frame instead of
    // the live scan. Names and regions still come from the live records, so a
    // country that has since gone quiet keeps its label.
    const atLiveFrame = frameIndex >= frames.length - 1;
    const mapAlertData = useMemo(() => {
        if (atLiveFrame || !frames.length) return activeAlertData;
        const scores = frames[frameIndex]?.scores || {};
        const meta = new Map(activeAlertData.map((r) => [r.iso_code, r]));
        return Object.entries(scores).map(([iso, score]) => ({
            ...(meta.get(iso) || { country: iso, region: null, total_articles: 0 }),
            iso_code: iso,
            alert_level: score,
            alert_status: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        }));
    }, [atLiveFrame, frames, frameIndex, activeAlertData]);

    const watchedRows = useMemo(
        () => watched
            .map((iso) => activeAlertData.find((r) => r.iso_code === iso))
            .filter(Boolean)
            .sort((a, b) => b.alert_level - a.alert_level),
        [watched, activeAlertData]
    );

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
            <Seo
                path="/"
                schema={{
                    '@context': 'https://schema.org',
                    '@type': 'WebSite',
                    name: 'GeoIntel',
                    description: 'Geopolitical news attributed to a country and scored for risk.',
                    potentialAction: {
                        '@type': 'SearchAction',
                        target: { '@type': 'EntryPoint', urlTemplate: `${window.location.origin}/search?q={search_term_string}` },
                        'query-input': 'required name=search_term_string',
                    },
                }}
            />

            <main className="flex-grow max-w-[1440px] mx-auto w-full px-6 py-10 lg:py-12">
                {/* Dashboard Header */}
                <header className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6 animate-fade-in">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Target size={18} className="text-cyan-400" />
                            <span className="text-[10px] font-extrabold uppercase tracking-[0.4em] text-cyan-400/60">Updated continuously</span>
                        </div>
                        <h1 className="text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
                            Geopolitical <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 decoration-cyan-500/20 underline underline-offset-8">Intelligence</span>
                        </h1>
                        <p className="text-slate-500 text-sm font-medium pt-2">
                            Tracking {totalReports} stories across {activeAlertData.length} countries.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="glass px-4 py-2 rounded-2xl flex items-center gap-3 border border-emerald-500/20">
                            <Activity size={16} className="text-emerald-400" />
                            <div className="leading-tight">
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Status</p>
                                <p className="text-xs font-bold text-emerald-400">
                                    {error ? 'OFFLINE' : 'LIVE'}
                                </p>
                            </div>
                        </div>
                    </div>
                </header>

                {/* ── SECTION 1: MAP + COUNTRY DOSSIER ───────
                    The map runs full width until a country is selected, then
                    yields two of five columns to the dossier. */}
                <section className="relative z-30 grid grid-cols-1 xl:grid-cols-5 gap-8 mb-12 items-start">
                    {selectedCountry && (
                        <div className="xl:col-span-2">
                            <CountryPanel
                                name={selectedLabel}
                                iso={selectedIso}
                                record={selectedRecord}
                                articles={countryArticles}
                                loading={countryArticlesLoading}
                                trend={trendSeries[selectedIso]}
                                liveChannel={selectedChannel}
                                watchToggle={
                                    selectedIso ? (
                                        <button
                                            onClick={() => toggleWatch(selectedIso)}
                                            className={`flex flex-col items-start transition-colors ${
                                                isWatched(selectedIso) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'
                                            }`}
                                        >
                                            <Star size={14} fill={isWatched(selectedIso) ? 'currentColor' : 'none'} />
                                            <span className="text-[9px] font-bold uppercase tracking-wider mt-1">
                                                {isWatched(selectedIso) ? 'Watching' : 'Watch'}
                                            </span>
                                        </button>
                                    ) : null
                                }
                                onClear={() => setSelectedCountry('')}
                                onViewAll={() =>
                                    feedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                }
                            />
                        </div>
                    )}
                    <div className={selectedCountry ? 'xl:col-span-3' : 'xl:col-span-5'}>
                        <MapChart
                            alertData={mapAlertData}
                            selectedCountry={selectedCountry}
                            selectedLabel={selectedLabel}
                            onCountrySelect={setSelectedCountry}
                            isWatched={isWatched}
                            onToggleWatch={toggleWatch}
                            heightClass={
                                selectedCountry
                                    ? 'h-[340px] md:h-[440px] xl:h-[560px]'
                                    : 'h-[380px] md:h-[520px] xl:h-[620px]'
                            }
                            timeline={
                                <TimeScrubber
                                    frames={frames}
                                    index={frameIndex}
                                    onIndexChange={setFrameIndex}
                                    playing={replaying}
                                    onPlayingChange={setReplaying}
                                />
                            }
                        />
                    </div>
                </section>

                {/* ── SECTION 1b: METRICS + LIVE BROADCAST ───
                    The player lives here rather than beside the map so the map
                    can go full width, and it stays in one fixed slot in the
                    tree — moving it between parents would remount the iframe
                    and restart the stream. `relative z-20` keeps the channel
                    dropdown above the sections below, which create stacking
                    contexts of their own via animate-fade-in-up. */}
                <section className="relative z-20 grid grid-cols-1 xl:grid-cols-5 gap-6 mb-12 items-start">
                    <div className="xl:col-span-2 order-first xl:order-last">
                        <LiveBroadcast
                            channels={channels}
                            selectedCountry={selectedCountry}
                            selectedLabel={selectedLabel}
                            loading={channelsLoading}
                        />
                    </div>

                    <div className="xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {[
                        { icon: Globe, label: 'Countries covered', value: activeAlertData.length, color: 'text-cyan-400', sub: 'With recent coverage' },
                        { icon: Activity, label: 'Average risk', value: `${avgAlert}%`, color: 'text-amber-400', sub: 'Across covered countries' },
                        { icon: AlertTriangle, label: 'High risk', value: criticalCount, color: 'text-rose-400', sub: 'Countries flagged critical' },
                        { icon: Newspaper, label: 'Stories held', value: totalReports, color: 'text-indigo-400', sub: 'In the current window' },
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
                    </div>
                </section>

                {/* ── WATCHLIST ─────────────────────────────── */}
                {(watchedRows.length > 0 || watched.length > 0) && (
                    <section className="mb-12 glass rounded-[2.5rem] p-6 lg:p-7 animate-fade-in-up">
                        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                    <Star size={16} className="text-amber-400" fill="currentColor" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">
                                    Watchlist
                                </h2>
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                                    {watched.length} pinned
                                </span>
                            </div>

                            {permission === 'default' && (
                                <button
                                    onClick={requestPermission}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-amber-400 hover:border-amber-500/30 transition-all"
                                >
                                    <Bell size={12} />
                                    Alert me on escalation
                                </button>
                            )}
                            {permission === 'granted' && (
                                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                                    <Bell size={12} /> Alerts on
                                </span>
                            )}
                            {permission === 'denied' && (
                                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                    <BellOff size={12} /> Alerts blocked in browser
                                </span>
                            )}
                        </div>

                        {watchedRows.length === 0 ? (
                            <p className="text-[11px] text-slate-600 font-medium">
                                Pinned zones have no coverage yet — they appear here once an ingest
                                cycle reaches them.
                            </p>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                {watchedRows.map((row) => (
                                    <button
                                        key={row.iso_code}
                                        onClick={() => setSelectedCountry(row.iso_code)}
                                        className="group text-left p-3.5 rounded-2xl bg-slate-900/40 border border-white/5 hover:border-amber-500/30 transition-all"
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <span className="text-lg leading-none">{getFlagEmoji(row.iso_code)}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleWatch(row.iso_code); }}
                                                aria-label={`Unpin ${row.country}`}
                                                className="text-amber-400/70 hover:text-amber-300 transition-colors"
                                            >
                                                <Star size={11} fill="currentColor" />
                                            </button>
                                        </div>
                                        <p className="text-[11px] font-bold text-white truncate">{row.country}</p>
                                        <p
                                            className="text-sm font-black tabular-nums mt-0.5"
                                            style={{ color: getAlertColor(row.alert_status) }}
                                        >
                                            {row.alert_level.toFixed(0)}%
                                        </p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* ── SECTION 2: ANALYTICS ──────────────────── */}
                <section className="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-12 items-stretch">
                    <div className="xl:col-span-2 glass rounded-[2.5rem] p-8 lg:p-10 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
                        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                                    <BarChart3 size={18} className="text-cyan-400" />
                                </div>
                                <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">Risk by country</h2>
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
                                    <p className="text-slate-600 font-bold uppercase tracking-widest text-[10px]">No countries match this filter</p>
                                </div>
                            ) : (
                                <div style={{
                                    minWidth: chartFilter === 'all' ? `${filteredChartData.length * 45}px` : '100%',
                                    height: '100%'
                                }}>
                                    <Suspense fallback={<div className="h-full w-full bg-white/[0.03] rounded-2xl animate-pulse" />}>
                                        <RiskByCountryChart
                                            data={filteredChartData}
                                            dense={chartFilter === 'all'}
                                            onSelect={setSelectedCountry}
                                        />
                                    </Suspense>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="glass rounded-[2.5rem] p-8 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                                <Zap size={18} className="text-indigo-400" />
                            </div>
                            <h2 className="text-base font-bold text-white uppercase tracking-widest">Highest risk</h2>
                        </div>
                        <div className="space-y-4">
                            {activeAlertData.length === 0 && (
                                <p className="text-slate-600 text-xs font-bold uppercase tracking-widest">Waiting for the first update</p>
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

                {/* ── SECTION 2b: FLASHPOINTS ───────────────── */}
                <section className="mb-12">
                    <RelationsPanel pairs={relations} onSelect={setSelectedCountry} />
                </section>

                {/* ── SECTION 2c: ESCALATION ────────────────── */}
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
                <div ref={feedRef} className="flex flex-col lg:flex-row gap-8 lg:items-start scroll-mt-24">
                    <Sidebar
                        countries={countries}
                        regions={regions}
                        // The label, not the raw value: a map click sets an ISO
                        // code, which would match no <option> and blank the select.
                        selectedCountry={selectedLabel}
                        selectedRegion={selectedRegion}
                        selectedLevel={selectedLevel}
                        selectedEventType={selectedEventType}
                        selectedDays={selectedDays}
                        searchTerm={searchTerm}
                        onCountryChange={setSelectedCountry}
                        onRegionChange={setSelectedRegion}
                        onLevelChange={setSelectedLevel}
                        onEventTypeChange={setSelectedEventType}
                        onDaysChange={setSelectedDays}
                        onSearchChange={setSearchTerm}
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
                                    {searchTerm
                                        ? `Search: “${searchTerm}”`
                                        : selectedCountry
                                            ? `Latest from ${selectedLabel}`
                                            : 'Latest stories'}
                                </h2>
                            </div>
                            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-widest tabular-nums">
                                {totalArticles} stories
                            </p>
                        </div>

                        {loading ? (
                            <div className="space-y-8">
                                {isFrontPage && <LeadStorySkeleton />}
                                <StoryGridSkeleton count={6} />
                            </div>
                        ) : error ? (
                            <div className="py-24 flex flex-col items-center justify-center rounded-3xl border border-rose-500/20 bg-slate-900/40 text-center px-10">
                                <AlertCircle className="text-rose-500 mb-5" size={40} />
                                <h3 className="font-display text-white font-bold text-xl mb-2">Can’t load stories</h3>
                                <p className="text-slate-400 text-sm max-w-md leading-relaxed mb-6">{error}</p>
                                <button onClick={fetchArticles} className="btn-primary">Try again</button>
                            </div>
                        ) : articles.length === 0 ? (
                            <div className="py-24 text-center rounded-3xl border border-white/10 bg-slate-900/30">
                                <p className="text-slate-400">No stories match these filters.</p>
                                <button onClick={resetFilters} className="btn-primary mt-5">Clear filters</button>
                            </div>
                        ) : (
                            <div className="space-y-10">
                                {/* Editorial hierarchy: on an unfiltered first page the
                                    top story is promoted and the next two run beside it.
                                    A flat grid weights every story identically, which is
                                    a dashboard pattern, not a front page. */}
                                {isFrontPage ? (
                                    <>
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                                            <div className="lg:col-span-2">
                                                <LeadStory article={leadStory} />
                                            </div>
                                            <div className="flex flex-col gap-6 lg:border-l lg:border-white/10 lg:pl-8">
                                                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                                    Also developing
                                                </h3>
                                                {secondaryStories.map((article) => (
                                                    <SecondaryStory key={article.id} article={article} />
                                                ))}
                                            </div>
                                        </div>

                                        {riverStories.length > 0 && (
                                            <div className="pt-2 border-t border-white/10">
                                                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 py-6">
                                                    More stories
                                                </h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                                                    {riverStories.map((article) => (
                                                        <StoryCard key={article.id} article={article} />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
                                        {articles.map((article) => (
                                            <StoryCard key={article.id} article={article} />
                                        ))}
                                    </div>
                                )}

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

        </div>
    );
};

export default Home;
