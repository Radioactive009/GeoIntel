import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Rss, Star } from 'lucide-react';
import ListingPage from './ListingPage';
import AskAbout from '../components/AskAbout';
import Seo from '../components/Seo';
import Sparkline from '../components/Sparkline';
import useWatchlist from '../hooks/useWatchlist';
import { getAlertAnalysis, getTrends, API_URL } from '../services/api';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';

/**
 * Country front — every story about one country, with its standing.
 *
 * The dossier beside the map is a glance; this is the addressable page you can
 * link someone to.
 */
const CountryPage = () => {
    const { iso } = useParams();
    const code = (iso || '').toUpperCase();
    const [record, setRecord] = useState(null);
    const [trend, setTrend] = useState([]);
    const { isWatched, toggle } = useWatchlist();

    useEffect(() => {
        let cancelled = false;
        Promise.all([
            getAlertAnalysis(false).catch(() => null),
            getTrends({ hours: 168, points: 40, country: code }).catch(() => null),
        ]).then(([alertRes, trendRes]) => {
            if (cancelled) return;
            setRecord((alertRes?.data || []).find((r) => r.iso_code === code) || null);
            setTrend(trendRes?.data?.series?.[code] || []);
        });
        return () => { cancelled = true; };
    }, [code]);

    const name = record?.country || code;
    const color = getAlertColor(record?.alert_status);

    const standing = record && (
        <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 p-5 rounded-2xl bg-surface border border-rule">
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Risk level</p>
                <p className="text-3xl font-black tabular-nums leading-none" style={{ color }}>
                    {record.alert_level.toFixed(1)}
                    <span className="text-base opacity-60">%</span>
                </p>
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Status</p>
                <p className="text-sm font-bold uppercase tracking-wider" style={{ color }}>
                    {ALERT_STATUS_LABEL[record.alert_status] || 'Stable'}
                </p>
            </div>
            <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Flagged critical</p>
                <p className="text-sm font-bold text-ink tabular-nums">{record.critical_alerts}</p>
            </div>
            {trend.length > 1 && (
                <div className="flex-grow min-w-[140px]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">7-day trend</p>
                    <Sparkline points={trend} color={color} width={200} height={36} strokeWidth={2} />
                </div>
            )}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => toggle(code)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-bold transition-all ${
                        isWatched(code)
                            ? 'text-risk-medium border-risk-medium/30 bg-risk-medium/10'
                            : 'text-body border-rule hover:text-risk-medium hover:border-risk-medium/30'
                    }`}
                >
                    <Star size={13} fill={isWatched(code) ? 'currentColor' : 'none'} />
                    {isWatched(code) ? 'Watching' : 'Watch'}
                </button>
                <a
                    href={`${API_URL}/feed.xml?country=${code}`}
                    className="p-2 rounded-xl border border-rule text-body hover:text-accent hover:border-accent transition-all"
                    title={`RSS feed for ${name}`}
                    aria-label={`RSS feed for ${name}`}
                >
                    <Rss size={13} />
                </a>
                <AskAbout
                    question={`What is happening in ${name} right now?`}
                    label="Ask"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-rule text-[12px] font-bold text-body hover:text-accent hover:border-accent transition-all"
                />
            </div>
        </div>
    );

    return (
        <>
            <Seo
                title={`${name} news`}
                description={`Latest geopolitical coverage of ${name}, with risk scoring and source attribution.`}
                path={`/country/${code}`}
            />
            <ListingPage
                title={
                    <span className="flex items-center gap-3">
                        <span aria-hidden="true">{getFlagEmoji(code)}</span>
                        {name}
                    </span>
                }
                standfirst={
                    record?.region
                        ? <>All coverage from the <Link to="/" className="text-accent hover:underline">monitoring feed</Link> · {record.region}</>
                        : 'All coverage from the monitoring feed.'
                }
                headerExtra={standing}
                filters={{ country: code }}
                emptyMessage={`No stories about ${name} yet. The catalog rotates through all 249 countries — coverage appears once a cycle reaches this one.`}
            />
        </>
    );
};

export default CountryPage;
