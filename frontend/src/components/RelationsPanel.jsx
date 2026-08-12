import React from 'react';
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
            <div className="glass rounded-[2.5rem] p-8 animate-fade-in-up">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                        <Link2 size={18} className="text-violet-400" />
                    </div>
                    <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">Flashpoints</h2>
                </div>
                <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                    No bilateral activity in this window. Pairs appear once articles name two
                    countries together.
                </p>
            </div>
        );
    }

    const busiest = Math.max(...pairs.map((p) => p.articles), 1);

    return (
        <div className="glass rounded-[2.5rem] p-8 animate-fade-in-up" style={{ animationDelay: '500ms' }}>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
                        <Link2 size={18} className="text-violet-400" />
                    </div>
                    <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">Flashpoints</h2>
                </div>
                <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">
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
                            className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/40 border border-white/5 hover:border-white/10 transition-colors"
                        >
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => onSelect(isoA)}
                                    title={nameA}
                                    className="text-lg leading-none hover:scale-125 transition-transform"
                                >
                                    {getFlagEmoji(isoA)}
                                </button>
                                <ArrowLeftRight size={11} className="text-slate-600" />
                                <button
                                    onClick={() => onSelect(isoB)}
                                    title={nameB}
                                    className="text-lg leading-none hover:scale-125 transition-transform"
                                >
                                    {getFlagEmoji(isoB)}
                                </button>
                            </div>

                            <div className="flex-grow min-w-0">
                                <p className="text-xs font-bold text-white truncate">
                                    {nameA} <span className="text-slate-600">·</span> {nameB}
                                </p>
                                {/* Bar is relative to the busiest pair, so the board reads as a
                                    ranking rather than an absolute scale. */}
                                <div className="flex items-center gap-2 mt-1.5">
                                    <div className="flex-grow h-1 rounded-full bg-slate-800/60 overflow-hidden">
                                        <div
                                            className="h-full rounded-full transition-all duration-1000"
                                            style={{ width: `${(pair.articles / busiest) * 100}%`, background: color }}
                                        />
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-500 tabular-nums shrink-0">
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
