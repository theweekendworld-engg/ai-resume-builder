import { describe, expect, test } from 'bun:test';
import { classifyUrl } from './url';
import { isPrivateAddress, safeFetch, staticUrlProblem } from './fetch';
import { decodeEntities, htmlToText, metaContent } from './html';
import { isLoginWall, LOGIN_WALL_REASON, parseLinkedInGuestJob, parseLinkedInPost } from './linkedin';
import { fetchAtsJob, parseGenericPage } from './ats';
import { capText, ingestUrl, MAX_INGEST_CHARS } from './index';
import { fakeFetch, fixture, publicResolver } from './testContext.test-utils';

// ───────────────────────────────────────────────────────────────── urls

describe('classifyUrl', () => {
    test.each([
        ['https://www.linkedin.com/jobs/view/4455902670/', 'linkedin_job', '4455902670'],
        ['https://www.linkedin.com/jobs/view/software-dev-engineer-ii-at-amazon-4455902670?trk=x', 'linkedin_job', '4455902670'],
        ['https://www.linkedin.com/jobs/search/?currentJobId=4455902670&keywords=sde', 'linkedin_job', '4455902670'],
        ['https://in.linkedin.com/jobs/collections/recommended/?currentJobId=4455902670', 'linkedin_job', '4455902670'],
    ])('%s is a LinkedIn job', (url, kind, id) => {
        const result = classifyUrl(url)!;
        expect(result.linkKind).toBe(kind as 'linkedin_job');
        expect(result.linkedinJobId).toBe(id);
    });

    test.each([
        ['https://www.linkedin.com/posts/someone_were-hiring-activity-7477613685709008896-5k3y', 'linkedin_post'],
        ['https://www.linkedin.com/feed/update/urn:li:activity:7477613685709008896/', 'linkedin_post'],
        ['https://www.linkedin.com/pulse/system-design-tips-jane-doe', 'linkedin_article'],
        ['https://www.linkedin.com/company/stripe/', 'linkedin_company'],
        ['https://www.linkedin.com/in/jane-doe/', 'linkedin_profile'],
        ['https://www.linkedin.com/learning/', 'web'],
        ['https://example.com/blog/post', 'web'],
    ])('%s → %s', (url, kind) => {
        expect(classifyUrl(url)!.linkKind).toBe(kind as never);
    });

    test('ATS job URLs carry the provider reference', () => {
        expect(classifyUrl('https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004')!.ats)
            .toEqual({ provider: 'greenhouse', boardToken: 'figma', jobId: '5364702004' });
        expect(classifyUrl('https://job-boards.greenhouse.io/figma/jobs/5364702004')!.linkKind).toBe('ats_job');
        expect(classifyUrl('https://jobs.lever.co/spotify/0a1b2c3d-1234-5678-9abc-def012345678')!.ats)
            .toEqual({ provider: 'lever', company: 'spotify', postingId: '0a1b2c3d-1234-5678-9abc-def012345678' });
        expect(classifyUrl('https://jobs.ashbyhq.com/ramp/34413f8d-6d7a-4d4e-9d59-0f8b0f7b1c2d/application')!.ats)
            .toEqual({ provider: 'ashby', boardToken: 'ramp', jobId: '34413f8d-6d7a-4d4e-9d59-0f8b0f7b1c2d' });
        expect(classifyUrl('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Bangalore/SDE-II_R123')!.ats)
            .toEqual({ provider: 'workday' });
    });

    test('a Greenhouse embed URL is not mistaken for a board named "embed"', () => {
        expect(classifyUrl('https://boards.greenhouse.io/embed/job_app?token=123')!.linkKind).toBe('web');
    });

    test('non-web schemes are refused', () => {
        expect(classifyUrl('file:///etc/passwd')).toBeNull();
        expect(classifyUrl('javascript:alert(1)')).toBeNull();
        expect(classifyUrl('not a url')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────── ssrf

describe('safeFetch refuses private targets', () => {
    test.each([
        '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
        '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
    ])('%s is private', (address) => {
        expect(isPrivateAddress(address)).toBe(true);
    });

    test.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '172.32.0.1'])('%s is public', (address) => {
        expect(isPrivateAddress(address)).toBe(false);
    });

    test('static checks: scheme, credentials, ports, local names', () => {
        expect(staticUrlProblem(new URL('ftp://example.com/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('https://user:pw@example.com/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('https://example.com:8080/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('http://localhost/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('http://metadata.google.internal/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('http://[::1]/'))).not.toBeNull();
        expect(staticUrlProblem(new URL('https://example.com/'))).toBeNull();
    });

    test('a hostname that resolves to a private address is not fetched', async () => {
        const { impl, calls } = fakeFetch({ '': { body: 'secret' } });
        const res = await safeFetch('https://evil.example/', { fetchImpl: impl, resolve: async () => ['169.254.169.254'] });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe('blocked_host');
        expect(calls).toHaveLength(0);
    });

    test('a redirect into a private address is caught at the hop', async () => {
        const calls: string[] = [];
        const impl = (async (url: string) => {
            calls.push(url);
            return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
        }) as unknown as typeof fetch;
        const res = await safeFetch('https://public.example/', { fetchImpl: impl, resolve: publicResolver });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe('blocked_host');
        expect(calls).toEqual(['https://public.example/']);
    });

    test('redirect loops stop after the limit', async () => {
        let n = 0;
        const impl = (async () => {
            n += 1;
            return new Response(null, { status: 301, headers: { location: `https://public.example/${n}` } });
        }) as unknown as typeof fetch;
        const res = await safeFetch('https://public.example/', { fetchImpl: impl, resolve: publicResolver });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe('too_many_redirects');
        expect(n).toBe(4); // first request + 3 redirects
    });

    test('bodies are capped', async () => {
        const { impl } = fakeFetch({ '': { body: 'x'.repeat(5_000) } });
        const res = await safeFetch('https://public.example/', { fetchImpl: impl, resolve: publicResolver, maxBytes: 1_000 });
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.body.length).toBe(1_000);
            expect(res.truncated).toBe(true);
        }
    });

    test('an aborted signal ends the fetch as a timeout', async () => {
        const controller = new AbortController();
        const impl = ((_: string, init?: RequestInit) => new Promise((_resolve, reject) => {
            const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (init?.signal?.aborted) fail();
            init?.signal?.addEventListener('abort', fail);
        })) as unknown as typeof fetch;
        const pending = safeFetch('https://public.example/', { fetchImpl: impl, resolve: publicResolver, signal: controller.signal });
        controller.abort();
        const res = await pending;
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toBe('timeout');
    });
});

// ─────────────────────────────────────────────────────────────── html

describe('html helpers', () => {
    test('entities decode once, including astral code points', () => {
        expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
        expect(decodeEntities('&#128640; We&#39;re')).toBe("🚀 We're");
    });

    test('htmlToText keeps paragraphs and bullets', () => {
        expect(htmlToText('<p>One</p><ul><li>a</li><li>b</li></ul><script>x()</script>')).toBe('One\n\n• a\n• b');
    });

    test('meta content is attribute-order agnostic and double-decoded', () => {
        const html = '<meta content="We&amp;#39;re hiring" property="og:title">';
        expect(metaContent(html, 'og:title')).toBe("We're hiring");
    });
});

// ─────────────────────────────────────────────────────────── linkedin

describe('LinkedIn guest job (real page, 2026-09-23)', () => {
    const page = parseLinkedInGuestJob(fixture('linkedin-guest-job.html'));

    test('extracts the top card', () => {
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.data.title).toBe('Software Dev Engineer II, Alexa Connections');
        expect(page.data.companyName).toBe('Amazon');
        expect(page.data.location).toBe('Chennai, Tamil Nadu, India');
        expect(page.data.applicantsText).toBe('101 applicants');
    });

    test('text carries the criteria header and the full description', () => {
        if (!page.ok) throw new Error('parse failed');
        expect(page.data.text).toContain('Posted 1 week ago');
        expect(page.data.text).toContain('Seniority level: Mid-Senior level');
        expect(page.data.text).toContain('Employment type: Full-time');
        expect(page.data.text).toContain('Join Alexa Connections');
        expect(page.data.text.length).toBeGreaterThan(1_500);
        expect(page.data.text).not.toMatch(/<[a-z]/i);
    });

    test('posted-ago stays as LinkedIn phrased it, never converted to a date', () => {
        if (!page.ok) throw new Error('parse failed');
        expect(page.data.postedAt).toBeNull();
    });

    test('a fragment with no description is refused, not half-parsed', () => {
        expect(parseLinkedInGuestJob('<h2 class="top-card-layout__title">Role</h2>').ok).toBe(false);
    });
});

describe('LinkedIn public post (real page, 2026-09-23)', () => {
    const url = 'https://www.linkedin.com/posts/muneer-ashraf-13170b182_were-hiring-software-development-engineer-activity-7477613685709008896-5k3y';
    const page = parseLinkedInPost(fixture('linkedin-public-post.html'), url);

    test('reads the full body from JSON-LD, not the truncated og text', () => {
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.data.text).toContain('At Park+');
        expect(page.data.text.length).toBeGreaterThan(1_000);
        expect(page.data.author).toBe('Muneer Ashraf');
        expect(page.data.authorUrl).toContain('linkedin.com/in/muneer-ashraf');
        expect(page.data.postedAt).toBe('2026-06-30T06:47:09.994Z');
        expect(page.data.title).toContain("We're Hiring");
    });

    test('a login wall is reported with the paste/extension advice', () => {
        const wall = '<html><head><title>Sign Up | LinkedIn</title></head><body>Join now</body></html>';
        expect(isLoginWall(wall, 'https://www.linkedin.com/authwall?trk=x')).toBe(true);
        expect(parseLinkedInPost(wall, 'https://www.linkedin.com/posts/x')).toEqual({ ok: false, reason: LOGIN_WALL_REASON });
    });

    test('truncated og text alone is not accepted as the post', () => {
        const html = '<meta property="og:description" content="We are hiring engineers who love distributed systems and…">';
        expect(parseLinkedInPost(html, 'https://www.linkedin.com/posts/x').ok).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────── ats

describe('ATS single-job reads', () => {
    test('Greenhouse: escaped content is unescaped and rendered', async () => {
        const { impl, calls } = fakeFetch({
            'boards-api.greenhouse.io/v1/boards/figma/jobs/123': {
                body: JSON.stringify({
                    title: 'Software Engineer, Backend',
                    content: '&lt;p&gt;Build &amp;amp; ship.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;',
                    absolute_url: 'https://boards.greenhouse.io/figma/jobs/123',
                    location: { name: 'San Francisco' },
                    company_name: 'Figma',
                    first_published: '2026-09-01T00:00:00Z',
                }),
            },
        });
        const res = await fetchAtsJob({ provider: 'greenhouse', boardToken: 'figma', jobId: '123' }, 'https://boards.greenhouse.io/figma/jobs/123', { fetchImpl: impl, resolve: publicResolver });
        expect(calls[0]).toContain('?content=true');
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.page.data.companyName).toBe('Figma');
        expect(res.page.data.text).toContain('Build & ship.');
        expect(res.page.data.text).toContain('• Go');
        expect(res.page.data.postedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    test('Ashby: finds the job on the board, carries structured pay', async () => {
        const { impl } = fakeFetch({
            'api.ashbyhq.com/posting-api/job-board/ramp': {
                body: JSON.stringify({ jobs: [
                    { id: 'other', title: 'Nope' },
                    { id: 'abc', title: 'Backend Engineer', location: 'New York', descriptionPlain: 'Build payments.', compensation: { scrapeableCompensationSalarySummary: '$180K - $250K' }, workplaceType: 'Hybrid' },
                ] }),
            },
        });
        const res = await fetchAtsJob({ provider: 'ashby', boardToken: 'ramp', jobId: 'abc' }, 'https://jobs.ashbyhq.com/ramp/abc', { fetchImpl: impl, resolve: publicResolver });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.page.data.title).toBe('Backend Engineer');
        expect(res.page.data.text).toContain('Compensation: $180K - $250K');
        expect(res.page.data.text).toContain('Workplace: Hybrid');
    });

    test('a 404 says the posting is gone', async () => {
        const { impl } = fakeFetch({});
        const res = await fetchAtsJob({ provider: 'lever', company: 'x', postingId: 'y' }, 'https://jobs.lever.co/x/y', { fetchImpl: impl, resolve: publicResolver });
        expect(res).toEqual({ ok: false, reason: 'This posting is no longer on the company’s job board.' });
    });

    test('generic pages prefer JSON-LD JobPosting', () => {
        const html = `<html><body><nav>Menu</nav><script type="application/ld+json">${JSON.stringify({
            '@context': 'https://schema.org', '@type': 'JobPosting', title: 'SDE II', description: '<p>Own services.</p>',
            hiringOrganization: { '@type': 'Organization', name: 'Acme' },
            jobLocation: { address: { addressLocality: 'Bengaluru', addressCountry: 'IN' } },
            jobLocationType: 'TELECOMMUTE', employmentType: 'FULL_TIME', datePosted: '2026-09-10',
        })}</script></body></html>`;
        const page = parseGenericPage(html);
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.data.companyName).toBe('Acme');
        expect(page.data.location).toBe('Bengaluru, IN');
        expect(page.data.text).toContain('Workplace: Remote');
        expect(page.data.text).toContain('Own services.');
    });

    test('generic pages fall back to main text and never name the publisher as the company', () => {
        const body = 'A long article about interviewing. '.repeat(10);
        const page = parseGenericPage(`<html><head><meta property="og:site_name" content="Medium"></head><body><nav>Nav junk</nav><main><p>${body}</p></main></body></html>`);
        expect(page.ok).toBe(true);
        if (!page.ok) return;
        expect(page.data.companyName).toBeNull();
        expect(page.data.text).not.toContain('Nav junk');
    });
});

// ───────────────────────────────────────────────────────────── ingestUrl

describe('ingestUrl', () => {
    test('a LinkedIn job URL reads the guest endpoint and cites the public job page', async () => {
        const { impl, calls } = fakeFetch({ 'jobs-guest/jobs/api/jobPosting/4455902670': { body: fixture('linkedin-guest-job.html') } });
        const res = await ingestUrl('https://www.linkedin.com/jobs/search/?currentJobId=4455902670', { fetchImpl: impl, resolve: publicResolver });
        expect(calls).toEqual(['https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4455902670']);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.data.sourceUrl).toBe('https://www.linkedin.com/jobs/view/4455902670/');
        expect(res.data.fetchVia).toBe('guest_job_api');
        expect(res.pages.map((page) => page.url)).toContain('https://www.linkedin.com/jobs/search/?currentJobId=4455902670');
    });

    test('a removed LinkedIn job is reported plainly', async () => {
        const { impl } = fakeFetch({});
        const res = await ingestUrl('https://www.linkedin.com/jobs/view/1234567890/', { fetchImpl: impl, resolve: publicResolver });
        expect(res).toEqual({ ok: false, reason: 'LinkedIn says this job no longer exists.' });
    });

    test('capText cuts at a paragraph boundary', () => {
        const para = 'x'.repeat(1_000);
        const text = Array.from({ length: 40 }, () => para).join('\n\n');
        const capped = capText(text);
        expect(capped.truncated).toBe(true);
        expect(capped.text.length).toBeLessThanOrEqual(MAX_INGEST_CHARS);
        expect(capped.text.endsWith('x')).toBe(true);
    });
});
