import type { Config } from 'tailwindcss';

/**
 * The extension's Tailwind theme, mirroring the web app's.
 *
 * Colour NAMES matter as much as values: the previous config exposed `bg` and
 * `surface` where the app has `background` and `card`, so a component could
 * not be moved between the two codebases and a reviewer could not diff them by
 * eye. Every name below exists in `src/app/globals.css` under `@theme inline`.
 *
 * The type scale is the app's nine roles (design/00 §4.1) rather than the five
 * arbitrary steps this file used to carry. The panel is 400px wide, so it
 * lives at the dense end of the scale — that is a density decision against a
 * shared ruler, not a private ruler.
 */
const config: Config = {
    content: ['./src/**/*.{ts,tsx,html}'],
    darkMode: ['class'],
    theme: {
        extend: {
            colors: {
                background: 'hsl(var(--background) / <alpha-value>)',
                foreground: 'hsl(var(--foreground) / <alpha-value>)',
                card: {
                    DEFAULT: 'hsl(var(--card) / <alpha-value>)',
                    foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
                    foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
                },
                primary: {
                    DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
                    foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
                    foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
                    foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
                    foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
                    foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
                },
                border: 'hsl(var(--border) / <alpha-value>)',
                'border-strong': 'hsl(var(--border-strong) / <alpha-value>)',
                input: 'hsl(var(--input) / <alpha-value>)',
                ring: 'hsl(var(--ring) / <alpha-value>)',

                // Semantic status — the only place colour carries meaning.
                success: {
                    DEFAULT: 'hsl(var(--success) / <alpha-value>)',
                    foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
                },
                warning: {
                    DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
                    foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
                },
                danger: {
                    DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
                    foreground: 'hsl(var(--danger-foreground) / <alpha-value>)',
                },
                info: {
                    DEFAULT: 'hsl(var(--info) / <alpha-value>)',
                    foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
                },
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
                xl: 'calc(var(--radius) + 2px)',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                heading: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
            },
            // design/00 §4.1, shifted one step denser for a 400px panel.
            fontSize: {
                xs: ['11px', '16px'],
                sm: ['12px', '18px'],
                base: ['13px', '20px'],
                lg: ['15px', '22px'],
                xl: ['17px', '24px'],
                '2xl': ['22px', '30px'],
            },
            transitionDuration: {
                micro: '120ms',
                state: '180ms',
                enter: '220ms',
                exit: '160ms',
            },
            transitionTimingFunction: {
                state: 'cubic-bezier(.2,0,0,1)',
                exit: 'cubic-bezier(.4,0,1,1)',
            },
        },
    },
    plugins: [],
};

export default config;
