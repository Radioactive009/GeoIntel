import React, { useState } from 'react';
import { KeyRound, Check, X } from 'lucide-react';
import { getOwnerKey, setOwnerKey } from '../services/api';

/**
 * Where the site owner identifies themselves to the assistant.
 *
 * The assistant has one tool that acts rather than reads: refreshing the feed,
 * which spends metered provider quota. That makes it something the owner can
 * ask for and a reader cannot, so the browser needs to hold the admin key.
 *
 * It lives here rather than in the build because Vite inlines environment
 * variables into the published bundle — a key configured that way would be
 * readable by every visitor, which is the opposite of what it is for.
 *
 * Deliberately unobtrusive: readers should never wonder what it is, and it
 * says plainly that the key stays in this browser, because a field asking for
 * a secret with no explanation is one people are right to distrust.
 */
const OwnerKey = () => {
    // Lazy: this reads localStorage, and a plain initialiser re-reads it on
    // every render for a value only used on the first.
    const [saved, setSaved] = useState(() => Boolean(getOwnerKey()));
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState('');

    const save = (event) => {
        event.preventDefault();
        const key = value.trim();
        if (!key) return;
        setOwnerKey(key);
        setSaved(true);
        setOpen(false);
        setValue('');
    };

    const forget = () => {
        setOwnerKey('');
        setSaved(false);
        setOpen(false);
    };

    if (saved) {
        return (
            <div className="mt-4 inline-flex items-center gap-2 text-[12px] text-slate-500">
                <Check size={13} className="text-emerald-400" />
                <span>Signed in as the site owner — you can ask it to refresh the news.</span>
                <button onClick={forget} className="underline hover:text-slate-300">
                    Forget key
                </button>
            </div>
        );
    }

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-400 transition-colors"
            >
                <KeyRound size={12} />
                Site owner?
            </button>
        );
    }

    return (
        <form onSubmit={save} className="mt-4 max-w-md">
            <div className="flex items-center gap-2">
                <input
                    type="password"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Admin API key"
                    className="flex-1 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-[13px] text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40"
                />
                <button
                    type="submit"
                    className="px-3 py-2 rounded-lg bg-cyan-500 text-white text-[13px] font-semibold hover:bg-cyan-400"
                >
                    Save
                </button>
                <button
                    type="button"
                    onClick={() => { setOpen(false); setValue(''); }}
                    aria-label="Cancel"
                    className="p-2 text-slate-500 hover:text-white"
                >
                    <X size={15} />
                </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
                Stored in this browser only, never in the site's code. It lets you ask the
                assistant to pull in the latest news.
            </p>
        </form>
    );
};

export default OwnerKey;
