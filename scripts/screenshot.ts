/**
 * Screenshot the app's key screens against a running dev server.
 *
 * Drives the system Chrome through puppeteer-core rather than downloading a
 * browser, so this works offline and in CI with `CHROME_PATH` set.
 *
 * Usage: bun run scripts/screenshot.ts [--dark]
 */
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const CHROME =
    process.env.CHROME_PATH ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.APP_URL ?? 'http://localhost:3000';
const OUT = 'screenshots';

const SCREENS = [
    { name: '01-marketing', path: '/' },
    { name: '02-sign-in', path: '/sign-in' },
    { name: '03-patterns', path: '/dev/patterns' },
    { name: '04-score', path: '/score' },
];

const dark = process.argv.includes('--dark');

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const problems: string[] = [];

for (const screen of SCREENS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
    if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)));
    page.on('pageerror', (e: unknown) =>
        consoleErrors.push('PAGEERROR ' + (e instanceof Error ? e.message : String(e)).slice(0, 160)),
    );

    const res = await page.goto(BASE + screen.path, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 700));

    const file = `${OUT}/${screen.name}${dark ? '-dark' : ''}.png`;
    await page.screenshot({ path: file, fullPage: true });

    // Cheap automated read of the two things a screenshot is bad at conveying:
    // whether anything rendered at all, and whether text is invisible.
    const audit = await page.evaluate(() => {
        const body = document.body;
        const text = (body.innerText ?? '').trim();
        const bg = getComputedStyle(body).backgroundColor;
        const fg = getComputedStyle(body).color;

        const parse = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const lum = (c: string) => {
            const [r, g, b] = parse(c);
            if (r === undefined) return null;
            const f = (v: number) => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const lb = lum(bg);
        const lf = lum(fg);
        const contrast =
            lb === null || lf === null
                ? null
                : (Math.max(lb, lf) + 0.05) / (Math.min(lb, lf) + 0.05);

        return { textLength: text.length, bg, fg, contrast: contrast ? +contrast.toFixed(2) : null };
    });

    const status = res?.status() ?? 0;
    console.log(
        `${screen.name.padEnd(14)} ${status}  text=${String(audit.textLength).padStart(6)}  ` +
            `bg=${audit.bg.padEnd(22)} contrast=${audit.contrast ?? '?'}`,
    );
    if (consoleErrors.length) {
        console.log(`   console: ${consoleErrors.slice(0, 3).join(' | ')}`);
        problems.push(`${screen.name}: ${consoleErrors.length} console error(s)`);
    }
    if (audit.textLength < 40) problems.push(`${screen.name}: rendered almost no text`);
    if (audit.contrast !== null && audit.contrast < 4.5) {
        problems.push(`${screen.name}: body contrast ${audit.contrast} is below 4.5:1`);
    }
    await page.close();
}

await browser.close();

console.log(problems.length ? '\nPROBLEMS:\n  ' + problems.join('\n  ') : '\nNo automated problems found.');
