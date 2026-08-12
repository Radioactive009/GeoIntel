import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pinned countries, persisted locally, with escalation notifications.
 *
 * Deliberately client-side: a watchlist is per-browser preference, and keeping
 * it out of the database means no accounts, no sync endpoint and no per-user
 * storage on a free-tier host.
 *
 * The alerting reuses the escalation engine that already runs server-side —
 * this only decides which of its findings the viewer asked to hear about, and
 * remembers what it has already announced so a country that stays escalated
 * does not re-notify on every poll.
 */
const STORAGE_KEY = 'geointel.watchlist';
const ANNOUNCED_KEY = 'geointel.announced';

const readStored = (key, fallback) => {
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback; // private mode, quota, or hand-edited garbage
    }
};

const writeStored = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage unavailable — the watchlist just does not persist */
    }
};

export const useWatchlist = () => {
    const [watched, setWatched] = useState(() => readStored(STORAGE_KEY, []));
    const [permission, setPermission] = useState(
        typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
    );
    const announced = useRef(new Set(readStored(ANNOUNCED_KEY, [])));

    useEffect(() => { writeStored(STORAGE_KEY, watched); }, [watched]);

    const isWatched = useCallback(
        (iso) => Boolean(iso) && watched.includes(iso.toUpperCase()),
        [watched]
    );

    const toggle = useCallback((iso) => {
        if (!iso) return;
        const code = iso.toUpperCase();
        setWatched((current) =>
            current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
        );
    }, []);

    const requestPermission = useCallback(async () => {
        if (typeof Notification === 'undefined') return 'unsupported';
        const result = await Notification.requestPermission();
        setPermission(result);
        return result;
    }, []);

    /**
     * Notify for watched countries that are escalating.
     *
     * Keyed by country *and* observation count, so the same escalation is
     * announced once but a genuinely new move still gets through.
     */
    const notifyEscalations = useCallback((rising = []) => {
        if (permission !== 'granted' || !watched.length) return;

        const fresh = rising.filter(
            (m) => watched.includes(m.iso_code) && !announced.current.has(`${m.iso_code}:${m.observations}`)
        );
        if (!fresh.length) return;

        fresh.forEach((mover) => {
            announced.current.add(`${mover.iso_code}:${mover.observations}`);
            try {
                new Notification(`${mover.country} is escalating`, {
                    body: `Risk ${mover.baseline.toFixed(0)} → ${mover.current.toFixed(0)} `
                        + `(${mover.z_score.toFixed(1)}σ above its own baseline)`,
                    tag: `geointel-${mover.iso_code}`,
                    icon: '/vite.svg',
                });
            } catch {
                /* some browsers block construction outside a user gesture */
            }
        });

        // Bounded so the key set cannot grow without limit across sessions.
        const keys = Array.from(announced.current).slice(-200);
        announced.current = new Set(keys);
        writeStored(ANNOUNCED_KEY, keys);
    }, [permission, watched]);

    return { watched, isWatched, toggle, permission, requestPermission, notifyEscalations };
};

export default useWatchlist;
