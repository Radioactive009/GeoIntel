import React from 'react';

/**
 * Loading placeholders shaped like the content they stand in for.
 *
 * A centred spinner tells the reader nothing and collapses the layout, so the
 * page jumps when data lands. These reserve the real footprint.
 */
const Shimmer = ({ className = '' }) => (
    <div className={`bg-white/[0.06] rounded animate-pulse ${className}`} />
);

export const StoryCardSkeleton = () => (
    <div className="rounded-2xl border border-white/10 bg-slate-900/30 overflow-hidden">
        <Shimmer className="aspect-[16/9] rounded-none" />
        <div className="p-5 space-y-3">
            <Shimmer className="h-2.5 w-24" />
            <div className="space-y-2">
                <Shimmer className="h-4 w-full" />
                <Shimmer className="h-4 w-4/5" />
            </div>
            <Shimmer className="h-3 w-32 mt-4" />
        </div>
    </div>
);

export const LeadStorySkeleton = () => (
    <div className="rounded-3xl border border-white/10 bg-slate-900/40 overflow-hidden">
        <Shimmer className="aspect-[16/9] md:aspect-[21/9] rounded-none" />
        <div className="p-6 md:p-8 space-y-3">
            <Shimmer className="h-2.5 w-32" />
            <Shimmer className="h-8 w-3/4" />
            <Shimmer className="h-8 w-1/2" />
        </div>
    </div>
);

export const StoryRowSkeleton = () => (
    <div className="flex gap-3 py-3">
        <div className="flex-grow space-y-2">
            <Shimmer className="h-4 w-full" />
            <Shimmer className="h-4 w-2/3" />
            <Shimmer className="h-3 w-24 mt-1" />
        </div>
        <Shimmer className="w-16 h-16 rounded-lg shrink-0" />
    </div>
);

export const StoryGridSkeleton = ({ count = 6 }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-6">
        {Array.from({ length: count }, (_, i) => <StoryCardSkeleton key={i} />)}
    </div>
);

export default Shimmer;
