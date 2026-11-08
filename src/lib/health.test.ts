import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configHealth } from './health';

const FULL = {
    CRON_SECRET: 'x', OPENROUTER_API_KEY: 'x', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b.c', WIN_MAGIC_LINK_SECRET: 'x',
    RAZORPAY_KEY_ID: 'x', RAZORPAY_KEY_SECRET: 'x', TAVILY_API_KEY: 'x', TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_WEBHOOK_SECRET: 'x',
    TELEGRAM_BOT_USERNAME: 'x', NEXT_PUBLIC_APP_URL: 'https://patronus.cv',
    UPSTASH_REDIS_REST_URL: 'https://r', UPSTASH_REDIS_REST_TOKEN: 'x',
    INBOUND_EMAIL_DOMAIN: 'in.patronus.cv', INBOUND_EMAIL_SECRET: 'x',
    GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', TOKEN_ENCRYPTION_KEY: 'x',
};

describe('configHealth', () => {
    test('a complete environment passes every check', () => {
        expect(configHealth(FULL).filter((check) => !check.ok)).toEqual([]);
    });

    // Production on 2026-09-27: no email provider, no payment provider.
    test('names what is missing, never a value', () => {
        const failing = configHealth({ ...FULL, RESEND_API_KEY: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' }).filter((c) => !c.ok);
        expect(failing.map((c) => c.id).sort()).toEqual(['email', 'payments']);
        expect(JSON.stringify(failing)).not.toContain('a@b.c');
    });

    // Settings says "coming soon" to customers; the operator gets the names.
    test('forwarding and calendar name their variables here, not in the UI', () => {
        const failing = configHealth({ ...FULL, INBOUND_EMAIL_DOMAIN: '', GOOGLE_CLIENT_SECRET: '' }).filter((c) => !c.ok);
        expect(failing.map((c) => c.id).sort()).toEqual(['google_calendar', 'inbound_email']);
        expect(failing.find((c) => c.id === 'inbound_email')?.fix).toContain('INBOUND_EMAIL_DOMAIN');
    });

    test('a protected vercel.app URL is flagged', () => {
        const check = configHealth({ ...FULL, NEXT_PUBLIC_APP_URL: 'https://x.vercel.app' }).find((c) => c.id === 'app_url');
        expect(check?.ok).toBe(false);
    });

    test('the vector store needs nothing by default; a Qdrant opt-in needs a server', () => {
        expect(configHealth(FULL).some((c) => c.id === 'vector_store')).toBe(false);
        expect(configHealth({ ...FULL, VECTOR_STORE: 'qdrant' }).find((c) => c.id === 'vector_store')?.ok).toBe(false);
        expect(configHealth({ ...FULL, VECTOR_STORE: 'qdrant', QDRANT_URL: 'https://q' }).find((c) => c.id === 'vector_store')?.ok).toBe(true);
    });

    test('half a WhatsApp config is flagged; none at all is not', () => {
        expect(configHealth(FULL).some((c) => c.id === 'whatsapp')).toBe(false);
        expect(configHealth({ ...FULL, WHATSAPP_ACCESS_TOKEN: 'x' }).find((c) => c.id === 'whatsapp')?.ok).toBe(false);
    });
});

/**
 * Customers never see a variable name (e2e QA 2026-11-07, finding 11: Settings
 * printed "(INBOUND_EMAIL_DOMAIN)"). Names belong in the checks above, which
 * render on /admin/ops. This reads every user-facing component and page and
 * fails on an env-shaped name inside a string or JSX text. Admin surfaces are
 * skipped: printing the variable is their job.
 */
describe('user-facing copy names no environment variable', () => {
    const SRC = join(import.meta.dir, '..');
    const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|SECRET|DOMAIN|URL|TOKEN|ID|USERNAME)\b/;

    function walk(dir: string, out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                if (entry === 'admin' || entry === 'api' || entry === 'dev') continue;
                walk(full, out);
            } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
                out.push(full);
            }
        }
        return out;
    }

    test('no component or page shows one', () => {
        const leaks: string[] = [];
        for (const file of [...walk(join(SRC, 'components')), ...walk(join(SRC, 'app'))]) {
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, ' ')
                .replace(/(^|[^:])\/\/.*$/gm, '$1')
                // Server logs are where the names belong.
                .replace(/console\.(?:log|info|warn|error)\([^;]*\);/g, ' ')
                // A template's `${CONSTANT}` is code, not copy.
                .replace(/\$\{[^}]*\}/g, ' ');
            const texts = [
                ...source.matchAll(/>([^<>{}]+)</g),
                ...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g),
            ].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
            for (const text of texts) {
                const hit = text.match(ENV_NAME);
                if (hit) leaks.push(`${file.slice(SRC.length + 1)}: ${hit[0]}`);
            }
        }
        expect([...new Set(leaks)].sort().join('\n')).toBe('');
    });
});
