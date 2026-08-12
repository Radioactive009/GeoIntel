import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getFlagEmoji, getAlertColor, ALERT_STATUS_LABEL } from '../utils/country';

/**
 * Risk-by-country bar chart.
 *
 * Split into its own module so Recharts — the single largest dependency —
 * loads only when this section is reached, rather than blocking the front
 * page for every visitor.
 */
const ChartTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;

    return (
        <div className="glass px-4 py-3 rounded-2xl shadow-2xl border border-white/10">
            <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg" aria-hidden="true">{getFlagEmoji(d.iso_code)}</span>
                <p className="text-white font-bold text-sm tracking-tight">{d.country}</p>
            </div>
            <div className="space-y-1">
                {[
                    ['Status', ALERT_STATUS_LABEL[d.alert_status] || 'STABLE', getAlertColor(d.alert_status)],
                    ['Risk', `${d.alert_level.toFixed(1)}%`, '#fff'],
                    ['Stories', d.total_articles, '#fff'],
                ].map(([label, value, color]) => (
                    <div key={label} className="flex items-center justify-between gap-8 text-[11px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wider">{label}</span>
                        <span className="font-bold tabular-nums" style={{ color }}>{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const RiskByCountryChart = ({ data, dense, onSelect }) => (
    <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 40, left: -20 }}>
            <XAxis
                dataKey="iso_code"
                tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                axisLine={false}
                tickLine={false}
                dy={15}
                interval={0}
                angle={-45}
                textAnchor="end"
            />
            <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} animationDuration={300} />
            <Bar
                dataKey="alert_level"
                radius={[6, 6, 6, 6]}
                barSize={dense ? 18 : 40}
                onClick={(d) => onSelect(d?.iso_code || '')}
                className="cursor-pointer"
            >
                {data.map((entry) => (
                    <Cell key={entry.iso_code} fill={getAlertColor(entry.alert_status)} fillOpacity={0.9} />
                ))}
            </Bar>
        </BarChart>
    </ResponsiveContainer>
);

export default RiskByCountryChart;
