/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: "#020617",
                "bg-light": "#0f172a",
                accent: {
                    DEFAULT: "#22d3ee",
                    blue: "#3b82f6",
                    indigo: "#6366f1",
                },
                risk: {
                    high: "#f43f5e",
                    medium: "#f59e0b",
                    low: "#10b981",
                }
            },
            fontFamily: {
                // These must match what index.html actually loads. They did
                // not: the config asked for Plus Jakarta Sans and JetBrains
                // Mono while the page fetched Outfit and Inter, so every
                // `font-sans` element — the whole app shell — silently fell
                // back to the browser's default sans.
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
                serif: ['"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            maxWidth: {
                prose: '68ch',
            },
            animation: {
                'shimmer': 'shimmer 2s linear infinite',
            },
            keyframes: {
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                }
            }
        },
    },
    plugins: [],
}
