/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            // Named by role, and resolved from the custom properties in
            // index.css so the palette has exactly one definition. Every entry
            // takes Tailwind's opacity modifiers (`border-rule/50`).
            colors: {
                background: "rgb(var(--paper) / <alpha-value>)",
                paper: "rgb(var(--paper) / <alpha-value>)",
                surface: {
                    DEFAULT: "rgb(var(--surface) / <alpha-value>)",
                    sunken: "rgb(var(--surface-sunken) / <alpha-value>)",
                },
                ink: "rgb(var(--ink) / <alpha-value>)",
                body: "rgb(var(--body) / <alpha-value>)",
                muted: "rgb(var(--muted) / <alpha-value>)",
                faint: "rgb(var(--faint) / <alpha-value>)",
                rule: {
                    DEFAULT: "rgb(var(--rule) / <alpha-value>)",
                    strong: "rgb(var(--rule-strong) / <alpha-value>)",
                },
                accent: {
                    DEFAULT: "rgb(var(--accent) / <alpha-value>)",
                    strong: "rgb(var(--accent-strong) / <alpha-value>)",
                    soft: "rgb(var(--accent-soft) / <alpha-value>)",
                },
                risk: {
                    high: "rgb(var(--risk-high) / <alpha-value>)",
                    medium: "rgb(var(--risk-medium) / <alpha-value>)",
                    low: "rgb(var(--risk-low) / <alpha-value>)",
                },
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
