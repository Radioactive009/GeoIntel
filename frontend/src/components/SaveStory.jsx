import { Bookmark, BookmarkCheck } from 'lucide-react';
import useNotes from '../hooks/useNotes';

/**
 * Put a story aside to come back to.
 *
 * Separate from the watchlist, which follows a country and notifies. This
 * follows nothing — it is a pile of things worth returning to, which is a
 * different act and wants a different affordance.
 */
const SaveStory = ({ item, className = '' }) => {
    const { saved, toggle } = useNotes();
    const kind = item.kind || 'story';
    const on = saved(kind, item.id);

    return (
        <button
            onClick={() => toggle(item)}
            aria-pressed={on}
            aria-label={on ? 'Remove from saved' : 'Save this story'}
            className={
                className
                || `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors ${
                    on
                        ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                        : 'border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                }`
            }
        >
            {on ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
            {on ? 'Saved' : 'Save'}
        </button>
    );
};

export default SaveStory;
