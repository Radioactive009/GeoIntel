import { Scale, Activity, Info } from 'lucide-react';

/**
 * How outlets framed an event, and how attention moved through it.
 *
 * Both readings only exist because articles are grouped: comparing two
 * outlets requires knowing they covered the same happening, and a curve
 * requires more than one point.
 */

const SHAPE_BLURB = {
    burst: 'Broke hard, then faded — most coverage arrived in the opening stretch.',
    'slow burn': 'Built over time rather than breaking all at once.',
    sustained: 'Coverage held steady across the event.',
};

/**
 * Diverging bars around the consensus.
 *
 * Report counts are shown deliberately. Most outlets file once, so a single
 * bar is one headline's reading rather than a settled editorial position, and
 * hiding that would dress up noise as a finding.
 */
export const FramingPanel = ({ framing }) => {
    if (!framing?.available || !framing.outlets?.length) return null;

    const widest = Math.max(1, ...framing.outlets.map((o) => Math.abs(o.divergence)));

    return (
        <section className="mb-10">
            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                <Scale size={13} /> How outlets framed it
            </h2>
            <p className="text-[12px] text-slate-600 mb-5 max-w-prose leading-relaxed">
                Each outlet&apos;s average severity reading against the consensus of{' '}
                <span className="text-slate-400 font-semibold tabular-nums">{framing.consensus}</span>{' '}
                across {framing.outlets.length} outlets. This measures how a story was
                <em> headlined</em>, not the article behind it.
            </p>

            <div className="space-y-1.5">
                {framing.outlets.map((outlet) => {
                    const above = outlet.divergence >= 0;
                    const width = (Math.abs(outlet.divergence) / widest) * 50;

                    return (
                        <div key={outlet.source} className="flex items-center gap-3 text-[12px]">
                            <span className="w-36 sm:w-48 truncate text-slate-400 text-right shrink-0">
                                {outlet.source}
                            </span>

                            {/* Centre line is the consensus; bars grow either side. */}
                            <div className="flex-grow relative h-5 flex items-center">
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/15" />
                                <div
                                    className="absolute h-2 rounded-sm"
                                    style={{
                                        [above ? 'left' : 'right']: '50%',
                                        width: `${width}%`,
                                        background: above ? '#f43f5e' : '#10b981',
                                        opacity: outlet.reports > 1 ? 0.9 : 0.55,
                                    }}
                                />
                            </div>

                            <span className="w-10 text-right tabular-nums font-semibold text-slate-300 shrink-0">
                                {outlet.score}
                            </span>
                            <span
                                className="w-14 text-right tabular-nums text-slate-600 shrink-0"
                                title={
                                    outlet.reports > 1
                                        ? `${outlet.reports} reports, own spread ${outlet.spread}`
                                        : 'Single report — one headline, not a settled position'
                                }
                            >
                                {outlet.reports > 1 ? `${outlet.reports} rep` : '1 rep'}
                            </span>
                        </div>
                    );
                })}
            </div>

            <p className="flex items-start gap-2 text-[11px] text-slate-600 mt-4 max-w-prose leading-relaxed">
                <Info size={12} className="mt-0.5 shrink-0" />
                Faded bars come from outlets with a single report. Scores are produced
                automatically from headline wording, so treat a lone bar as a hint rather
                than a verdict.
            </p>
        </section>
    );
};

/** When coverage arrived, and how quickly it stopped. */
export const CoveragePanel = ({ coverage }) => {
    if (!coverage?.available || !coverage.points?.length) return null;

    const peak = Math.max(1, ...coverage.points.map((p) => p.count));

    return (
        <section className="mb-10">
            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">
                <Activity size={13} /> Attention
            </h2>
            <p className="text-[12px] text-slate-600 mb-4 max-w-prose leading-relaxed">
                {SHAPE_BLURB[coverage.shape] || 'How coverage arrived over time.'}
            </p>

            <div className="flex items-end gap-[3px] h-20 mb-3" role="img"
                 aria-label={`Coverage over ${coverage.span_hours} hours, ${coverage.shape}`}>
                {coverage.points.map((point, i) => (
                    <div
                        key={i}
                        className="flex-1 rounded-t-sm bg-cyan-500/70 min-h-[2px] transition-all"
                        style={{ height: `${(point.count / peak) * 100}%` }}
                        title={`${point.count} report${point.count === 1 ? '' : 's'} around hour ${point.hour}`}
                    />
                ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
                {[
                    ['Half-life', `${coverage.half_life_hours}h`, 'When half of all coverage had been published'],
                    ['Peak', `${coverage.peak_hour}h`, 'Busiest point after the first report'],
                    ['Span', `${coverage.span_hours}h`, 'First report to last'],
                ].map(([label, value, hint]) => (
                    <div key={label} className="p-3 rounded-xl bg-slate-900/50 border border-white/10" title={hint}>
                        <p className="font-display text-lg font-bold text-white tabular-nums">{value}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">
                            {label}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
};
