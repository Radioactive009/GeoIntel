import React from 'react';
import { Sun, Newspaper, Scale } from 'lucide-react';

/**
 * Lets the reader choose the register of what they are shown.
 *
 * Not a filter in the usual sense — it is a mood. Someone opening a news site
 * to feel better and someone opening it to be informed want different things
 * from the same archive, and forcing both through one feed serves neither.
 *
 * Deliberately three options rather than two. Most news is neither uplifting
 * nor grim, and offering only the poles would either mislabel the middle or
 * hide it.
 */
const MODES = [
    {
        id: '',
        label: 'Everything',
        blurb: 'The full feed',
        icon: Newspaper,
        accent: 'text-slate-300',
        active: 'bg-slate-200 text-slate-900',
    },
    {
        id: 'uplifting',
        label: 'Good news',
        blurb: 'Rescues, recoveries, progress',
        icon: Sun,
        accent: 'text-emerald-400',
        active: 'bg-emerald-500 text-white',
    },
    {
        id: 'serious',
        label: 'Serious',
        blurb: 'Conflict, crisis, hard news',
        icon: Scale,
        accent: 'text-amber-400',
        active: 'bg-amber-500 text-white',
    },
];

const MoodSwitch = ({ value, onChange, counts = {} }) => (
    <div className="flex flex-col sm:flex-row gap-2" role="group" aria-label="Choose what to read">
        {MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = value === mode.id;
            const count = counts[mode.id || 'all'];

            return (
                <button
                    key={mode.id || 'all'}
                    onClick={() => onChange(mode.id)}
                    aria-pressed={isActive}
                    className={`group flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left flex-1 ${
                        isActive
                            ? 'border-transparent shadow-lg'
                            : 'border-white/10 bg-slate-900/40 hover:border-white/25'
                    }`}
                >
                    <span
                        className={`p-2 rounded-xl shrink-0 transition-colors ${
                            isActive ? mode.active : `bg-white/5 ${mode.accent}`
                        }`}
                    >
                        <Icon size={16} />
                    </span>
                    <span className="min-w-0">
                        <span className={`block text-[13px] font-bold ${isActive ? 'text-white' : 'text-slate-200'}`}>
                            {mode.label}
                            {typeof count === 'number' && (
                                <span className="ml-1.5 text-[11px] font-semibold text-slate-500 tabular-nums">
                                    {count}
                                </span>
                            )}
                        </span>
                        <span className="block text-[11px] text-slate-500 truncate">{mode.blurb}</span>
                    </span>
                </button>
            );
        })}
    </div>
);

export default MoodSwitch;
