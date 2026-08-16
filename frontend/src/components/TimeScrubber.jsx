import { useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, History } from 'lucide-react';

/**
 * Replays the map through recorded history.
 *
 * Only works because snapshots are point-in-time: while every capture held the
 * cumulative all-time mean, every frame looked identical and there was nothing
 * to replay.
 *
 * Frames are driven by the parent — this owns the transport (position, play,
 * reset) and nothing else.
 */
const FRAME_MS = 600;

const TimeScrubber = ({ frames = [], index, onIndexChange, playing, onPlayingChange }) => {
    const timer = useRef(null);
    const atLive = index >= frames.length - 1;

    useEffect(() => {
        if (!playing || frames.length < 2) return undefined;
        timer.current = setInterval(() => {
            onIndexChange((current) => {
                if (current >= frames.length - 1) {
                    onPlayingChange(false);   // stop at the present rather than looping
                    return current;
                }
                return current + 1;
            });
        }, FRAME_MS);
        return () => clearInterval(timer.current);
    }, [playing, frames.length, onIndexChange, onPlayingChange]);

    if (frames.length < 2) {
        return (
            <div className="flex items-center gap-2 mt-4 px-1">
                <History size={12} className="text-faint" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-faint">
                    Timeline builds as snapshots accumulate
                </p>
            </div>
        );
    }

    const stamp = frames[index]?.t;
    const label = stamp
        ? new Date(stamp).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
        : '—';

    return (
        <div className="mt-4 flex items-center gap-3 flex-wrap">
            <button
                onClick={() => {
                    // Replaying from the present would end immediately, so
                    // pressing play at the live edge rewinds first.
                    if (!playing && atLive) onIndexChange(0);
                    onPlayingChange(!playing);
                }}
                className="p-2 rounded-xl glass border border-rule text-body hover:text-accent hover:border-accent transition-all active:scale-95 shrink-0"
                title={playing ? 'Pause' : 'Replay history'}
                aria-label={playing ? 'Pause replay' : 'Replay history'}
            >
                {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>

            <input
                type="range"
                min={0}
                max={frames.length - 1}
                value={index}
                onChange={(e) => {
                    onPlayingChange(false);
                    onIndexChange(Number(e.target.value));
                }}
                aria-label="Scrub map through time"
                className="flex-grow min-w-[120px] h-1 accent-accent cursor-pointer"
            />

            <div className="flex items-center gap-2 shrink-0">
                <span
                    className={`text-[10px] font-bold tabular-nums tracking-wide ${
                        atLive ? 'text-risk-low' : 'text-accent'
                    }`}
                >
                    {atLive ? 'LIVE' : label}
                </span>
                {!atLive && (
                    <button
                        onClick={() => { onPlayingChange(false); onIndexChange(frames.length - 1); }}
                        className="p-1.5 rounded-lg text-muted hover:text-ink transition-colors"
                        title="Return to now"
                        aria-label="Return to now"
                    >
                        <RotateCcw size={12} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default TimeScrubber;
