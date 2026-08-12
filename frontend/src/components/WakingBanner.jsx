import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { onBackendWaking } from '../services/api';

/**
 * Explains a cold start instead of letting it look like a broken site.
 *
 * On a free-tier host the container stops after ~15 minutes idle, so the
 * first visitor after a quiet spell waits 30-60s for it to boot. Silence for
 * that long reads as failure; naming what is happening does not.
 *
 * Shown only after a short grace period — a warm backend answers in
 * milliseconds and should never flash this.
 */
const GRACE_MS = 1200;

const WakingBanner = () => {
    const [waking, setWaking] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => onBackendWaking(setWaking), []);

    useEffect(() => {
        if (!waking) {
            setVisible(false);
            return undefined;
        }
        const timer = setTimeout(() => setVisible(true), GRACE_MS);
        return () => clearTimeout(timer);
    }, [waking]);

    if (!visible) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="sticky top-[57px] z-40 bg-amber-500/10 border-b border-amber-500/20 backdrop-blur-sm"
        >
            <div className="max-w-[1440px] mx-auto px-6 py-2.5 flex items-center gap-3">
                <Loader2 size={14} className="text-amber-400 animate-spin shrink-0" />
                <p className="text-[13px] text-amber-200/90">
                    <span className="font-semibold">Waking the server.</span>{' '}
                    <span className="text-amber-200/70">
                        It sleeps after a quiet spell and takes up to a minute to start. Stories
                        will appear automatically.
                    </span>
                </p>
            </div>
        </div>
    );
};

export default WakingBanner;
