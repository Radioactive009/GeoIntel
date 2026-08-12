import React, { useEffect, useState } from 'react';
import { getHealth } from '../services/api';

/**
 * "Updated N minutes ago" in the masthead.
 *
 * A news site that silently serves yesterday's stories is worse than one that
 * admits it. This reads the pipeline's own record of when it last ran, so it
 * reports whether the *feed was refreshed* rather than whether an article
 * happened to be published recently.
 */
const POLL_MS = 120000;

const format = (minutes) => {
    if (minutes === null || minutes === undefined) return null;
    if (minutes < 2) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)} min ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
};

const FreshnessBadge = () => {
    const [health, setHealth] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const check = () => getHealth()
            .then((res) => { if (!cancelled) setHealth(res.data); })
            .catch(() => { /* the waking banner already covers an unreachable API */ });

        check();
        const timer = setInterval(check, POLL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);

    const label = format(health?.minutes_since_ingest);
    if (!label) return null;

    const stale = Boolean(health?.stale);

    return (
        <span
            className="hidden xl:flex items-center gap-1.5 text-[11px] font-medium shrink-0"
            title={
                stale
                    ? 'The feed has not refreshed recently. It updates on the next cycle.'
                    : 'Time since the pipeline last checked for new stories.'
            }
        >
            <span
                className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`}
                aria-hidden="true"
            />
            <span className={stale ? 'text-amber-400/90' : 'text-slate-500'}>
                Updated {label}
            </span>
        </span>
    );
};

export default FreshnessBadge;
