import type { Config } from 'tailwindcss';

const config: Config = {
    content: ['./src/**/*.{ts,tsx,html}'],
    darkMode: ['class'],
    theme: {
        extend: {
            colors: {
                bg: 'hsl(var(--bg) / <alpha-value>)',
                surface: 'hsl(var(--surface) / <alpha-value>)',
                border: 'hsl(var(--border) / <alpha-value>)',
                muted: 'hsl(var(--muted) / <alpha-value>)',
                'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
                foreground: 'hsl(var(--foreground) / <alpha-value>)',
                primary: 'hsl(var(--primary) / <alpha-value>)',
                'primary-foreground': 'hsl(var(--primary-foreground) / <alpha-value>)',
                destructive: 'hsl(var(--destructive) / <alpha-value>)',
                success: 'hsl(var(--success) / <alpha-value>)',
                warning: 'hsl(var(--warning) / <alpha-value>)',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            fontSize: {
                xs: ['11px', '16px'],
                sm: ['12px', '18px'],
                base: ['13px', '20px'],
                lg: ['14px', '20px'],
                xl: ['16px', '22px'],
            },
        },
    },
    plugins: [],
};

export default config;
