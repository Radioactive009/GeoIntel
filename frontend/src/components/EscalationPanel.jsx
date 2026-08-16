import { TrendingUp, TrendingDown, Activity, Clock } from 'lucide-react';
import { getFlagEmoji } from '../utils/country';
import Sparkline from './Sparkline';

const WINDOW_LABEL = { 24: '24h', 72: '3d', 168: '7d', 720: '30d' };

const MoverRow = ({ mover, series, rising, onSelect }) => {
    const color = rising ? '#f43f5e' : '#10b981';
    const Icon = rising ? TrendingUp : TrendingDown;

    return (
        <button
            onClick={() => onSelect(mover.country)}
            className="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-surface border border-rule hover:border-rule transition-all hover:translate-x-1"
        >
            <span className="text-xl leading-none shrink-0">{getFlagEmoji(mover.iso_code)}</span>

            <div className="flex-grow min-w-0">
                <p className="text-xs font-bold text-ink truncate">{mover.country}</p>
                <p className="text-[10px] font-medium text-muted tabular-nums">
                    {mover.baseline.toFixed(0)} → {mover.current.toFixed(0)}
                    <span className="text-faint"> · {mover.article_count} reports</span>
                </p>
            </div>

            <Sparkline points={series} color={color} width={64} height={22} />

            <div className="text-right shrink-0 w-[62px]">
                <div className="flex items-center justify-end gap-1" style={{ color }}>
                    <Icon size={12} />
                    <span className="text-xs font-bold tabular-nums">
                        {mover.delta > 0 ? '+' : ''}{mover.delta.toFixed(1)}
                    </span>
                </div>
                {/* No `uppercase` here: it would render σ (std-dev) as Σ (summation). */}
                <p className="text-[9px] font-bold text-faint tabular-nums tracking-wider">
                    {Math.abs(mover.z_score).toFixed(1)}σ
                </p>
            </div>
        </button>
    );
};

/**
 * Escalation board.
 *
 * Ranks by z-score against each country's own recent baseline rather than raw
 * delta, so a country that always swings wildly doesn't crowd out a genuine,
 * unusual move somewhere normally quiet.
 */
const EscalationPanel = ({ movers, series = {}, windowHours, onWindowChange, onSelect }) => {
    const rising = movers?.rising || [];
    const falling = movers?.falling || [];
    const history = movers?.history;
    const hasData = rising.length > 0 || falling.length > 0;

    return (
        <div className="glass rounded-2xl p-8 animate-fade-in-up" style={{ animationDelay: '450ms' }}>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-risk-high/10 border border-risk-high/30">
                        <Activity size={18} className="text-risk-high" />
                    </div>
                    <h2 className="text-base font-bold text-ink uppercase tracking-widest leading-none">
                        Escalation Board
                    </h2>
                </div>

                <div className="flex bg-surface p-1 rounded-xl border border-rule gap-1">
                    {[24, 72, 168, 720].map((h) => (
                        <button
                            key={h}
                            onClick={() => onWindowChange(h)}
                            className={`px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all ${
                                windowHours === h
                                    ? 'bg-accent text-ink shadow-lg shadow-transparent'
                                    : 'text-muted hover:text-body'
                            }`}
                        >
                            {WINDOW_LABEL[h]}
                        </button>
                    ))}
                </div>
            </div>

            {!hasData ? (
                <div className="py-12 text-center space-y-3">
                    <Clock size={28} className="text-faint mx-auto" />
                    <p className="text-muted font-bold uppercase tracking-widest text-[10px]">
                        Building baseline
                    </p>
                    <p className="text-[11px] text-faint font-medium max-w-xs mx-auto leading-relaxed">
                        {history?.distinct_observations
                            ? `${history.distinct_observations} observation${history.distinct_observations === 1 ? '' : 's'} recorded so far. Escalation needs at least 4 before it can tell a real move from noise.`
                            : 'Risk history is captured at the end of each ingest cycle. The board fills in as observations accumulate.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
                    <section className="space-y-2">
                        <p className="text-[10px] font-extrabold text-risk-high uppercase tracking-[0.2em] px-1">
                            Escalating
                        </p>
                        {rising.length ? (
                            rising.map((m) => (
                                <MoverRow
                                    key={m.iso_code}
                                    mover={m}
                                    series={series[m.iso_code]}
                                    rising
                                    onSelect={onSelect}
                                />
                            ))
                        ) : (
                            <p className="text-[11px] text-faint font-medium px-1">No zones escalating in this window.</p>
                        )}
                    </section>

                    <section className="space-y-2">
                        <p className="text-[10px] font-extrabold text-risk-low uppercase tracking-[0.2em] px-1">
                            De-escalating
                        </p>
                        {falling.length ? (
                            falling.map((m) => (
                                <MoverRow
                                    key={m.iso_code}
                                    mover={m}
                                    series={series[m.iso_code]}
                                    rising={false}
                                    onSelect={onSelect}
                                />
                            ))
                        ) : (
                            <p className="text-[11px] text-faint font-medium px-1">No zones de-escalating in this window.</p>
                        )}
                    </section>
                  </div>

                    <p className="text-[9px] text-faint font-medium leading-relaxed pt-3 border-t border-rule">
                        σ is the move measured against that country&apos;s own recent volatility — a large
                        shift in a normally quiet zone outranks routine noise elsewhere.
                    </p>
                </div>
            )}
        </div>
    );
};

export default EscalationPanel;
