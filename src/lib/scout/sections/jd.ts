/**
 * Scout's JD section: the posting as structured requirements.
 *
 * Two sources, split by what each is good at. `readPosting` — the same reader
 * the resume path uses, with its skill filter and must/nice split — does the
 * reading that needs judgement. The regexes in `fit/jdSignals.ts` do the
 * reading that must not involve judgement: work mode, pay, years, employment
 * type, where every value is a quote from the page or null.
 *
 * `readPosting` makes its own `generateStructured` call rather than going
 * through `ctx.step.ai`, so it can keep one prompt shared with the resume path.
 * Its usage comes back on the result and is charged to the step here — the
 * run's ledger and `ApiUsageLog` see the same call (sessionId = runId).
 */

import { createHash } from 'node:crypto';
import { readResearch, writeResearch } from '@/lib/research/cache';
import { readPosting, type ReadPostingResult } from '@/lib/resume/posting';

/** Bump when the posting prompt or its schema changes. */
const POSTING_PARSE_VERSION = 'v1';
import { dataOf, type ScoutSection } from '@/lib/scout/section';
import {
    detectEmploymentType,
    detectWorkMode,
    extractApplyUrl,
    extractCompensationText,
    extractExperienceText,
    extractLocation,
} from '@/lib/scout/fit/jdSignals';
import type { JdData, ScoutRequirement } from '@/lib/scout/types';

/** Below this there is nothing to read requirements out of. */
const MIN_JD_CHARS = 200;

type PostingReader = (params: Parameters<typeof readPosting>[0]) => Promise<ReadPostingResult>;
let reader: PostingReader = readPosting;

export const __testing = {
    setReader(fn: PostingReader) {
        reader = fn;
    },
    reset() {
        reader = readPosting;
    },
};

export const jdSection: ScoutSection<'jd'> = async (ctx) => {
    const ingest = dataOf(ctx.sections, 'ingest');
    const classify = dataOf(ctx.sections, 'classify');
    if (!ingest) return { status: 'unavailable', reason: 'The link could not be read, so there is no description to extract' };

    const text = ingest.text.trim();
    if (text.length < MIN_JD_CHARS) {
        return {
            status: 'unavailable',
            reason: 'The post is too short to contain a job description. Share the job link itself if there is one.',
        };
    }

    // Shared parse, keyed by the posting TEXT: the same posting gives the same
    // requirements to every user (live runs of one posting read 10 musts, then
    // 12, and the score moved with them), and the model is paid once per posting.
    const cacheKey = `posting:${POSTING_PARSE_VERSION}:${createHash('sha256').update(text).digest('hex').slice(0, 40)}`;
    const cached = await readResearch<{ brief: ReadPostingResult['brief'] }>(ctx.step, cacheKey);
    let brief: ReadPostingResult['brief'];
    if (cached?.payload?.brief) {
        brief = cached.payload.brief;
        ctx.step.log('posting parse cache hit', { cacheKey });
    } else {
        const read = await reader({
            jobDescription: text,
            userId: ctx.userId,
            sessionId: ctx.runId,
            feature: 'scout',
            task: 'scoutPostingRead',
        });
        ctx.step.addCost(read.usage.costUsd);
        brief = read.brief;
        await writeResearch({ key: cacheKey, kind: 'posting', value: { brief }, pages: [], step: ctx.step });
    }

    const requirements: ScoutRequirement[] = brief.requirements.map((requirement) => ({
        id: requirement.id,
        text: requirement.text,
        kind: requirement.kind,
    }));

    const location = ingest.location ?? extractLocation(text);
    const data: JdData = {
        // The page's own title and company outrank the model's reading of the
        // body: LinkedIn's top card is the employer's structured field.
        role: (ingest.linkKind === 'linkedin_job' || ingest.linkKind === 'ats_job') && ingest.title
            ? ingest.title
            : brief.role || classify?.roleTitle || ingest.title || '',
        company: ingest.companyName || brief.company || classify?.companies[0] || '',
        seniority: brief.seniority,
        domain: brief.domain,
        location,
        workMode: detectWorkMode({ location, title: ingest.title, text }),
        employmentType: detectEmploymentType(text),
        compensationText: extractCompensationText(text),
        experienceText: extractExperienceText(text),
        requirements,
        skills: brief.skills,
        responsibilities: brief.responsibilities,
        applyUrl: extractApplyUrl({ sourceUrl: ingest.sourceUrl, linkKind: ingest.linkKind, text }),
    };

    if (requirements.length === 0 && data.skills.length === 0) {
        return { status: 'unavailable', reason: 'No requirements could be read from this posting', data };
    }
    return { status: 'ok', data };
};
