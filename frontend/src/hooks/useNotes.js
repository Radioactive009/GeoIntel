import { useCallback, useEffect, useState } from 'react';
import { isSaved, normaliseNotes, toNote } from '../lib/studyNotes';

/**
 * Stories a reader has put aside, with their own notes on them.
 *
 * Local, like the watchlist, and for the same reasons: no accounts, no
 * per-user rows on a free-tier host, and what someone is reading for is their
 * own business. The cost is that notes live in one browser, which is why
 * exporting them is part of the feature rather than an extra.
 */
const STORAGE_KEY = 'geointel.notes';

const read = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? normaliseNotes(parsed) : [];
    } catch {
        return [];                    // private mode, quota, or hand-edited storage
    }
};

const write = (notes) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    } catch {
        /* storage unavailable — notes last as long as the tab does */
    }
};

export const useNotes = () => {
    const [notes, setNotes] = useState(read);

    // Saving in one tab should be visible in another, and this is also what
    // keeps two open copies of the site from overwriting each other's notes.
    useEffect(() => {
        const sync = (event) => {
            if (event.key === STORAGE_KEY) setNotes(read());
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);

    const persist = useCallback((next) => {
        const clean = normaliseNotes(next);
        setNotes(clean);
        write(clean);
        return clean;
    }, []);

    /** Save, or update what is already saved, keeping any note already written. */
    const save = useCallback((item, note = '') => {
        setNotes((current) => {
            const existing = current.find((n) => n.kind === (item.kind || 'story') && n.id === String(item.id));
            const entry = toNote(item, {
                note: note || existing?.note || '',
                savedAt: existing?.savedAt || new Date().toISOString(),
            });
            const next = normaliseNotes([entry, ...current.filter((n) => n !== existing)]);
            write(next);
            return next;
        });
    }, []);

    const remove = useCallback((kind, id) => {
        setNotes((current) => {
            const next = current.filter((n) => !(n.kind === kind && n.id === String(id)));
            write(next);
            return next;
        });
    }, []);

    const toggle = useCallback((item) => {
        const kind = item.kind || 'story';
        if (isSaved(notes, kind, item.id)) remove(kind, item.id);
        else save(item);
    }, [notes, remove, save]);

    const annotate = useCallback((kind, id, note) => {
        setNotes((current) => {
            const next = current.map((n) => (
                n.kind === kind && n.id === String(id)
                    ? { ...n, note: String(note).slice(0, 2000) }
                    : n
            ));
            write(next);
            return next;
        });
    }, []);

    const clear = useCallback(() => persist([]), [persist]);

    return {
        notes,
        saved: (kind, id) => isSaved(notes, kind, id),
        save,
        remove,
        toggle,
        annotate,
        clear,
    };
};

export default useNotes;
