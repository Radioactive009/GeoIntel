import { useMemo, useId } from 'react';
import { token } from '../utils/palette';

/**
 * Minimal SVG sparkline.
 *
 * Hand-rolled rather than a Recharts <LineChart>: dozens of these render at
 * once inside the ranking list, and a full chart runtime per row is far more
 * machinery than a polyline needs.
 */
const Sparkline = ({
    points = [],
    color = token('accent'),
    width = 96,
    height = 28,
    strokeWidth = 1.5,
    showArea = true,
}) => {
    const gradientId = useId();

    const geometry = useMemo(() => {
        const values = points
            .map((p) => (typeof p === 'number' ? p : p?.score))
            .filter((v) => typeof v === 'number' && Number.isFinite(v));

        if (values.length < 2) return null;

        const min = Math.min(...values);
        const max = Math.max(...values);
        // A flat series would divide by zero; render it as a centred line.
        const span = max - min || 1;
        const padY = strokeWidth;
        const usableH = height - padY * 2;

        const coords = values.map((v, i) => {
            const x = (i / (values.length - 1)) * width;
            const y = padY + (1 - (v - min) / span) * usableH;
            return [x, y];
        });

        const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
        const area = `${line} L${width},${height} L0,${height} Z`;

        return { line, area, last: coords[coords.length - 1], flat: max === min };
    }, [points, width, height, strokeWidth]);

    if (!geometry) {
        return (
            <div
                className="flex items-center justify-center text-[8px] font-bold uppercase tracking-widest text-faint"
                style={{ width, height }}
            >
                No history
            </div>
        );
    }

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="overflow-visible shrink-0"
            role="img"
            aria-label="Risk trend"
        >
            {showArea && !geometry.flat && (
                <>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <path d={geometry.area} fill={`url(#${gradientId})`} />
                </>
            )}
            <path
                d={geometry.line}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={geometry.flat ? 0.45 : 1}
            />
            <circle cx={geometry.last[0]} cy={geometry.last[1]} r={strokeWidth + 0.6} fill={color} />
        </svg>
    );
};

export default Sparkline;
