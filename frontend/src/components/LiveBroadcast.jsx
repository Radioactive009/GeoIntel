import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Radio, Play, Volume2, VolumeX, ExternalLink, Tv } from 'lucide-react';
import { normalizeCountry } from '../utils/country';
import ChannelSelect from './ChannelSelect';

/**
 * Live broadcast player.
 *
 * Only ONE iframe is ever mounted — the active channel. The rail is plain
 * buttons, because booting a dozen YouTube players on page load is a large,
 * pointless cost.
 *
 * Streams are resolved to a concrete `live_video_id` by the backend rather
 * than using YouTube's channel-level auto-embed: testing showed the channel
 * form failed for most broadcasters and resolved at least one to an unrelated
 * stream, while embedding a resolved video id worked nearly everywhere.
 */
const LiveBroadcast = ({ channels = [], selectedCountry, loading }) => {
    const [activeId, setActiveId] = useState(null);
    const [muted, setMuted] = useState(true);
    const [started, setStarted] = useState(false);
    const userPicked = useRef(false);

    const live = useMemo(() => channels.filter((c) => c.is_live && c.live_video_id), [channels]);
    const offline = useMemo(() => channels.filter((c) => !c.is_live || !c.live_video_id), [channels]);

    // Follow the map/sidebar selection unless the viewer has picked a channel.
    const countryMatch = useMemo(() => {
        if (!selectedCountry) return null;
        const target = normalizeCountry(selectedCountry);
        return live.find((c) => c.country && normalizeCountry(c.country) === target) || null;
    }, [live, selectedCountry]);

    useEffect(() => {
        if (countryMatch) {
            setActiveId(countryMatch.id);
            userPicked.current = false;
        }
    }, [countryMatch]);

    useEffect(() => {
        if (!activeId && live.length) setActiveId(live[0].id);
    }, [live, activeId]);

    const active = live.find((c) => c.id === activeId) || live[0] || null;

    const src = active
        ? `https://www.youtube.com/embed/${active.live_video_id}` +
          `?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1`
        : null;

    const pick = (channel) => {
        userPicked.current = true;
        setActiveId(channel.id);
        setStarted(true);
    };

    return (
        <div className="glass rounded-[2.5rem] p-6 lg:p-8 animate-fade-in-up" style={{ animationDelay: '150ms' }}>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
                        <Radio size={18} className="text-rose-400 animate-pulse" />
                    </div>
                    <h2 className="text-base font-bold text-white uppercase tracking-widest leading-none">
                        Live Broadcast
                    </h2>
                    {live.length > 0 && (
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            {live.length} streams online
                        </span>
                    )}
                </div>

                {active && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setMuted((m) => !m)}
                            className="p-2 rounded-xl glass border border-white/5 text-slate-300 hover:text-cyan-400 hover:border-cyan-500/30 transition-all"
                            title={muted ? 'Unmute' : 'Mute'}
                        >
                            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                        </button>
                        <a
                            href={`https://www.youtube.com/watch?v=${active.live_video_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl glass border border-white/5 text-slate-300 hover:text-cyan-400 hover:border-cyan-500/30 transition-all"
                            title="Open on YouTube"
                        >
                            <ExternalLink size={14} />
                        </a>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="aspect-video rounded-3xl bg-slate-900/60 border border-white/5 flex items-center justify-center">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">
                        Resolving streams…
                    </p>
                </div>
            ) : !active ? (
                <div className="aspect-video rounded-3xl bg-slate-900/60 border border-white/5 flex flex-col items-center justify-center gap-3 px-8 text-center">
                    <Tv size={28} className="text-slate-700" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-600">
                        No streams online
                    </p>
                    <p className="text-[11px] text-slate-600 font-medium max-w-sm leading-relaxed">
                        Broadcaster streams restart through the day. The backend re-checks which
                        channels are live on every ingest cycle.
                    </p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="relative aspect-video rounded-3xl overflow-hidden border border-white/10 bg-black shadow-2xl">
                        {/* The iframe mounts only once the viewer opts in, so the page
                            doesn't pull a video stream on every load. */}
                        {started ? (
                            <iframe
                                key={`${active.id}-${muted}`}
                                src={src}
                                title={active.live_title || active.name}
                                className="absolute inset-0 w-full h-full"
                                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                                allowFullScreen
                                referrerPolicy="strict-origin-when-cross-origin"
                                loading="lazy"
                            />
                        ) : (
                            <button
                                onClick={() => setStarted(true)}
                                className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-4 group bg-gradient-to-br from-slate-900 to-slate-950"
                            >
                                <div className="p-5 rounded-full bg-rose-500/15 border border-rose-500/30 group-hover:bg-rose-500/25 group-hover:scale-110 transition-all">
                                    <Play size={26} className="text-rose-400 translate-x-0.5" fill="currentColor" />
                                </div>
                                <div className="text-center px-6">
                                    <p className="text-sm font-bold text-white">{active.name}</p>
                                    <p className="text-[11px] text-slate-500 font-medium mt-1 max-w-md line-clamp-2">
                                        {active.live_title || 'Live broadcast'}
                                    </p>
                                </div>
                            </button>
                        )}

                        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-600/90 backdrop-blur-sm pointer-events-none">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            <span className="text-[9px] font-extrabold text-white uppercase tracking-widest">Live</span>
                        </div>
                    </div>

                    {/* Searchable picker — a rail of chips stopped scaling once
                        the catalog grew past a couple of dozen channels. */}
                    <ChannelSelect
                        channels={live}
                        offline={offline}
                        activeId={active.id}
                        onSelect={pick}
                    />

                    {selectedCountry && !countryMatch && (
                        <p className="text-[10px] text-slate-600 font-medium px-1">
                            No live broadcaster for {selectedCountry} — showing {active.name}.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default LiveBroadcast;
