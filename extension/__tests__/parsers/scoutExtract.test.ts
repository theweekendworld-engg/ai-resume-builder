/**
 * "Send to Patronus" extraction against a synthetic LinkedIn feed.
 *
 * What matters, and what each test pins:
 *   - one post, not the feed: the most-visible post, or the one clicked;
 *   - the permalink from the post URN, never `/feed/` (which would dedupe every
 *     post a user ever sends into one Scout run);
 *   - comments, reaction counts and screen-reader duplicates stay out;
 *   - when LinkedIn renames every class, the density fallback still finds it.
 */

import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    canonicalLinkedinJobUrl,
    cleanPostText,
    extractForScout,
    linkedinPageKind,
    permalinkForUrn,
    stripTracking,
} from '../../src/parsers/scoutExtract';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(join(__dirname, '..', '..', '__fixtures__', 'linkedin-feed-synthetic.html'), 'utf8');

type Rect = { top: number; bottom: number };

/**
 * Mount `html` at `url`. `rects` gives chosen elements a viewport position
 * (happy-dom has no layout); everything else sits on screen at 0–30px.
 */
function mount(html: string, url: string, rects: Record<string, Rect> = {}) {
    const window = new Window({ url, width: 1024, height: 800 });
    if (!window.SyntaxError) window.SyntaxError = SyntaxError;

    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
    if (title) window.document.title = title;
    window.document.body.innerHTML = body;

    const defaultRect = { top: 0, bottom: 30, left: 0, right: 100, width: 100, height: 30, x: 0, y: 0 };
    const rectFor = function (this: Element) {
        const own = this.id ? rects[this.id] : undefined;
        if (own) return { ...defaultRect, ...own, height: own.bottom - own.top };
        return defaultRect;
    };
    window.Element.prototype.getBoundingClientRect = rectFor as never;
    window.HTMLElement.prototype.getBoundingClientRect = rectFor as never;

    const g = globalThis as unknown as Record<string, unknown>;
    g.window = window;
    g.document = window.document;
    g.location = window.location;
    for (const name of ['Element', 'Node', 'NodeFilter', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement',
        'HTMLSelectElement', 'HTMLButtonElement', 'HTMLFormElement', 'HTMLAnchorElement', 'HTMLLabelElement']) {
        g[name] = (window as unknown as Record<string, unknown>)[name];
    }
    const original = window.getComputedStyle.bind(window);
    const patched = ((el: Element) => new Proxy(original(el as never), {
        get(target, prop) {
            const raw = (target as never)[prop];
            if (prop === 'opacity' && !raw) return '1';
            if (prop === 'display' && !raw) return 'block';
            if (prop === 'visibility' && !raw) return 'visible';
            return raw;
        },
    })) as typeof window.getComputedStyle;
    (window as unknown as { getComputedStyle: typeof patched }).getComputedStyle = patched;
    g.getComputedStyle = patched;
    return window;
}

const FEED_URL = 'https://www.linkedin.com/feed/';
/** Post A scrolled past, post B on screen, post C below the fold. */
const B_ON_SCREEN = {
    'post-a': { top: -900, bottom: -100 },
    'post-b': { top: 120, bottom: 700 },
    'post-c': { top: 900, bottom: 1300 },
};

describe('feed: which post', () => {
    test('with no anchor, sends the post most visible in the viewport', () => {
        mount(FEED, FEED_URL, B_ON_SCREEN);
        const out = extractForScout();
        expect(out).not.toBeNull();
        expect(out!.kindHint).toBe('linkedin_post');
        expect(out!.text).toContain('system design interviews at Stripe');
        expect(out!.text).not.toContain('backend engineers');
    });

    test('a reshare carries both the commentary and the original post', () => {
        mount(FEED, FEED_URL, B_ON_SCREEN);
        const out = extractForScout()!;
        expect(out.text).toContain('four rounds including a practical coding exercise');
        // The OUTER post's URN, not the reshared original's.
        expect(out.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000002/');
    });

    test('an anchor inside a post wins over scroll position', () => {
        const window = mount(FEED, FEED_URL, B_ON_SCREEN);
        const anchor = window.document.querySelector('#post-a .update-components-text span') as unknown as Element;
        const out = extractForScout({ anchor })!;
        expect(out.text).toContain("We're hiring backend engineers in Bengaluru");
        expect(out.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000001/');
    });
});

describe('feed: what is read', () => {
    function postA() {
        const window = mount(FEED, FEED_URL, B_ON_SCREEN);
        const anchor = window.document.querySelector('#post-a') as unknown as Element;
        return extractForScout({ anchor })!;
    }

    test('keeps line breaks and hashtags, drops LinkedIn chrome', () => {
        const out = postA();
        expect(out.text).toContain('Hybrid, 3 days in office');
        expect(out.text).toContain('#hiring');
        expect(out.text).not.toMatch(/hashtag/i);
        expect(out.text).not.toMatch(/see more/i);
        expect(out.text.split('\n').length).toBeGreaterThan(2);
    });

    test('comments, reaction counts and action buttons stay out', () => {
        const out = postA();
        expect(out.text).not.toContain('Great opportunity');
        expect(out.text).not.toContain('reactions');
        expect(out.text).not.toContain('Repost');
    });

    test('author read once, not doubled by the screen-reader copy', () => {
        const out = postA();
        expect(out.author).toBe('Priya Sharma');
        expect(out.title).toBe('Priya Sharma on LinkedIn');
        expect(out.authorUrl).toStartWith('https://www.linkedin.com/in/priya-sharma-eng/');
        expect(out.method).toBe('post_selector');
    });
});

describe('the url is never an ambiguous feed url', () => {
    test('a feed post without a URN is sent with no url, keyed on its text server-side', () => {
        mount(FEED, FEED_URL, {
            'post-a': { top: -900, bottom: -500 },
            'post-b': { top: -500, bottom: -100 },
            'post-c': { top: 100, bottom: 600 },
        });
        const out = extractForScout()!;
        expect(out.text).toContain('Series B');
        expect(out.url).toBeNull();
        expect(out.pageUrl).toBe(FEED_URL);
    });

    test('a permalink page keeps its own url even without a URN in the DOM', () => {
        const single = '<html><head><title>Post | LinkedIn</title></head><body><main><div class="feed-shared-update-v2"><div class="update-components-text"><span>We are opening a new engineering hub in Pune and hiring across platform teams this quarter.</span></div></div></main></body></html>';
        mount(single, 'https://www.linkedin.com/posts/someone_hiring-activity-7241111111111111111-abcd?utm_source=share&utm_medium=member_desktop');
        const out = extractForScout()!;
        expect(out.url).toBe('https://www.linkedin.com/posts/someone_hiring-activity-7241111111111111111-abcd');
    });
});

describe('when LinkedIn renames every class', () => {
    test('the density fallback still finds the post body', () => {
        // Rename every class LinkedIn uses, keeping only the structural URN.
        const renamed = FEED.replace(/class="[^"]*"/g, 'class="x9f2"');
        mount(renamed, FEED_URL, B_ON_SCREEN);
        const out = extractForScout();
        expect(out).not.toBeNull();
        expect(out!.text).toContain('system design interviews at Stripe');
        expect(out!.url).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000002/');
        expect(out!.method).toBe('post_density');
    });
});

describe('job pages', () => {
    const JOB = `<html><head><title>SDE II | Acme | LinkedIn</title></head><body><main>
      <h1>Software Development Engineer II</h1>
      <div class="job-details-jobs-unified-top-card__company-name"><a href="/company/acme/">Acme</a></div>
      <div id="job-details" class="jobs-description__content">
        <h2>About the job</h2>
        <p>Acme is looking for a Software Development Engineer II to join the payments platform team in Bengaluru.</p>
        <h3>Responsibilities</h3>
        <ul><li>Design and build distributed services handling millions of transactions.</li><li>Own services end to end, from design to on-call.</li><li>Mentor junior engineers and review code.</li></ul>
        <h3>Qualifications</h3>
        <ul><li>3+ years of experience building backend systems in Java or Go.</li><li>Strong knowledge of data structures, algorithms and system design.</li><li>Experience with AWS, Kafka and PostgreSQL.</li></ul>
        <h3>Requirements</h3>
        <p>Bachelor's degree in Computer Science or equivalent practical experience. Hybrid role, three days a week in office.</p>
      </div></main></body></html>`;

    test('a LinkedIn job is sent with the job description and its canonical url', () => {
        mount(JOB, 'https://www.linkedin.com/jobs/search/?currentJobId=4455902670&keywords=sde');
        const out = extractForScout()!;
        expect(out.kindHint).toBe('linkedin_job');
        expect(out.method).toBe('job_description');
        expect(out.url).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(out.text).toContain('distributed services');
    });
});

describe('pure helpers', () => {
    test('linkedinPageKind', () => {
        expect(linkedinPageKind('https://www.linkedin.com/feed/')).toBe('feed');
        expect(linkedinPageKind('https://www.linkedin.com/feed/update/urn:li:activity:1/')).toBe('post');
        expect(linkedinPageKind('https://www.linkedin.com/posts/a_b-activity-1-x')).toBe('post');
        expect(linkedinPageKind('https://www.linkedin.com/jobs/view/4455902670/')).toBe('job');
        expect(linkedinPageKind('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4455902670')).toBe('job');
        expect(linkedinPageKind('https://www.linkedin.com/pulse/how-we-hire-someone')).toBe('article');
        expect(linkedinPageKind('https://boards.greenhouse.io/acme/jobs/1')).toBe('other');
    });

    test('canonicalLinkedinJobUrl handles every LinkedIn job url shape', () => {
        expect(canonicalLinkedinJobUrl('https://www.linkedin.com/jobs/view/4455902670/')).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(canonicalLinkedinJobUrl('https://in.linkedin.com/jobs/view/software-dev-engineer-ii-at-amazon-4455902670?trk=x')).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(canonicalLinkedinJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=4455902670')).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(canonicalLinkedinJobUrl('https://www.linkedin.com/feed/')).toBeNull();
    });

    test('permalinkForUrn accepts activity, share and ugcPost, and nothing else', () => {
        expect(permalinkForUrn('urn:li:activity:7240000000000000001')).toBe('https://www.linkedin.com/feed/update/urn:li:activity:7240000000000000001/');
        expect(permalinkForUrn('urn:li:ugcPost:123')).toBe('https://www.linkedin.com/feed/update/urn:li:ugcPost:123/');
        expect(permalinkForUrn('urn:li:member:123')).toBeNull();
    });

    test('stripTracking removes share tracking but keeps meaningful params', () => {
        expect(stripTracking('https://www.linkedin.com/posts/x?utm_source=share&trk=public_post&rcm=abc'))
            .toBe('https://www.linkedin.com/posts/x');
        expect(stripTracking('https://example.com/job?id=7&utm_medium=email')).toBe('https://example.com/job?id=7');
    });

    test('cleanPostText', () => {
        expect(cleanPostText('Hello world   \n\n\n\nhashtag\n#ai …see more')).toBe('Hello world\n\n#ai');
    });
});
