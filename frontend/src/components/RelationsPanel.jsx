import { Link2, ArrowLeftRight } from 'lucide-react';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';

/**
 * Flashpoints — country pairs appearing in the same stories.
 *
 * Every article already carries a ranked list of the countries named in it;
 * the runner-up used to be discarded. Keeping it turns each article into an
 * edge, and aggregating those edges surfaces the active bilateral tensions
 * (Russia–Ukraine, Israel–Palestine) with no extra analysis.
 */
const RelationsPanel = ({ pairs = [], onSelect }) => {
    if (!pairs.length) {
        return (
            <div className="glass rounded-2xl p-8 animate-fade-in-up">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl bg-surface-sunken border border-rule">
                        <Link2 size={18} className="text-accent" />
                    </div>
                    <h2 className="text-base font-bold text-ink uppercase tracking-widest leading-none">Flashpoints</h2>
                </div>
                <p className="text-[11px] text-faint font-medium leading-relaxed">
                    No bilateral activity in this window. Pairs appear once articles name two
                    countries together.
                </p>
            </div>
        );
    }

    const busiest = Math.max(...pairs.map((p) => p.articles), 1);

    return (
        <div className="glass rounded-2xl p-8 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-surface-sunken border border-rule">
                        <Link2 size={18} className="text-accent" />
                    </div>
                    <h2 className="text-base font-bold text-ink uppercase tracking-widest leading-none">Flashpoints</h2>
                </div>
                <span className="text-[9px] font-bold text-faint uppercase tracking-widest">
                    Countries reported together
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2">
                {pairs.map((pair) => {
                    const color = getAlertColor(pair.status);
                    const [isoA, isoB] = pair.iso_codes;
                    const [nameA, nameB] = pair.countries;

                    return (
                        <div
                            key={pair.iso_codes.join('-')}
                            className="flex items-center gap-3 p-3 rounded-2xl bg-surface border border-rule hover:border-rule transition-colors"
                        >
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => onSelect(isoA)}
                                    title={nameA}
                                    className="text-lg leading-none hover:scale-125 transition-transform"
                                >
                                    {getFlagEmoji(isoA)}
                                </button>
                                <ArrowLeftRight size={11} className="text-faint" />
                                <button
                                    onClick={() => onSelect(isoB)}
                                    title={nameB}
                                    className="text-lg leading-none hover:scale-125 transition-transform"
                                >
                                    {getFlagEmoji(isoB)}
                                </button>
                            </div>

                            <div className="flex-grow min-w-0">
                                <p className="text-xs font-bold text-ink truncate">
                                    {nameA} <span className="text-faint">·</span> {nameB}
                                </p>
                                {/* Bar is relative to the busiest pair, so the board reads as a
                                    ranking rather than an absolute scale. */}
                                <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex-grow h-1 rounded-full bg-surface-sunken overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-1000"
                                            style={{ width: `${(pair.articles / busiest) * 100}%`, background: color }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-bold text-muted tabular-nums shrink-0">
                                        {pair.articles}
                                    </span>
                                </div>
                            </div>

                            <span
                                className="text-[9px] font-extrabold uppercase tracking-widest shrink-0 w-[52px] text-right"
                                style={{ color }}
                            >
                                {ALERT_STATUS_LABEL[pair.status] || 'STABLE'}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default RelationsPanel;
