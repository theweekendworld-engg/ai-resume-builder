/**
 * Scout's fit section: this role against the user's record and preferences.
 *
 * Two model calls at most, each with a narrow job:
 *
 *   1. MATCH — which numbered line of the record answers which requirement
 *      (`fit/match.ts`). Returns line numbers only; code maps them back to
 *      the user's own words. Soft traits, pure-years requirements and obvious
 *      named-skill matches never reach it.
 *   2. SUMMARY — two or three sentences written from the computed fields,
 *      under the numeric guard, and then checked against the verdict and the
 *      coverage counts (`summaryAgrees`). A summary warmer than the numbers is
 *      discarded for the deterministic one.
 *
 * Every judgement in between — score, verdict, preference conflicts, the one
 * question — is code in `fit/evaluate.ts`. Either call failing degrades the
 * section (keyword fallback, plain summary); neither can fail it.
 */

import { z } from 'zod';
import { getExtensionProfileBundle } from '@/lib/extension/profile';
import { getSkillsWithEvidence } from '@/lib/resume/tools/evidence';
import { dataOf, type ScoutSection, type SectionContext } from '@/lib/scout/section';
import {
    buildFitRecord,
    deterministicSummary,
    evaluateFit,
    summaryAgrees,
    type Coverage,
    type FitRecord,
} from '@/lib/scout/fit/evaluate';
import {
    MATCH_SYSTEM,
    MatchResponseSchema,
    buildMatchPrompt,
    fallbackJudgements,
    planMatching,
    resolveModelJudgements,
    type Judgement,
    type MatchPlan,
} from '@/lib/scout/fit/match';
import type { FitData, JdData } from '@/lib/scout/types';
import { parseUserGenerationPreferences, type UserGenerationPreferences } from '@/lib/userPreferences';

export type FitSources = {
    record: FitRecord;
    prefs: UserGenerationPreferences;
};

async function loadFitSources(userId: string): Promise<FitSources> {
    const [bundle, skills] = await Promise.all([
        getExtensionProfileBundle(userId),
        getSkillsWithEvidence(userId).catch(() => []),
    ]);
    return {
        record: buildFitRecord({
            profile: bundle.profile,
            experiences: bundle.experiences,
            projects: bundle.projects,
            education: bundle.education.map((school) => ({
                institution: school.institution,
                degree: school.degree,
                fieldOfStudy: school.fieldOfStudy,
            })),
            skills,
        }),
        // The bundle's wire type widens this to unknown; re-parse to the real shape.
        prefs: parseUserGenerationPreferences(bundle.profile.preferences),
    };
}

let loader: (userId: string) => Promise<FitSources> = loadFitSources;

export const __testing = {
    setLoader(fn: (userId: string) => Promise<FitSources>) {
        loader = fn;
    },
    reset() {
        loader = loadFitSources;
    },
};

// ────────────────────────────────────────────────────────────────── match

type MatchOutcome = { judgements: Map<string, Judgement>; softIds: Set<string>; via: 'model' | 'fallback' | 'none' };

async function matchRequirements(ctx: SectionContext, plan: MatchPlan, record: FitRecord): Promise<MatchOutcome> {
    if (plan.toAsk.length === 0 || record.empty) {
        return { judgements: new Map(), softIds: new Set(), via: 'none' };
    }
    try {
        const { data } = await ctx.step.ai({
            task: 'scoutFitMatch',
            schema: MatchResponseSchema,
            system: MATCH_SYSTEM,
            prompt: buildMatchPrompt(plan.toAsk, record),
            reasoningEffort: 'low',
            maxRetries: 1,
        });
        const resolved = resolveModelJudgements(data, plan.toAsk, record.lines.length);
        // A requirement the model skipped falls back to keywords, not to "gap".
        const missing = plan.toAsk.filter((requirement) => !resolved.judgements.has(requirement.id));
        for (const [id, judgement] of fallbackJudgements(missing, record)) resolved.judgements.set(id, judgement);
        return { ...resolved, via: 'model' };
    } catch (error) {
        ctx.step.log('matching fell back to keywords', { error: String(error) });
        return { judgements: fallbackJudgements(plan.toAsk, record), softIds: new Set(), via: 'fallback' };
    }
}

// ──────────────────────────────────────────────────────────────── summary

const SummarySchema = z.object({ summary: z.string().min(1).max(700) });

const SYSTEM = `You write the two-to-three sentence verdict a careful career coach would give on one job for one candidate.

Rules:
- Use ONLY the facts in the ANALYSIS JSON. Do not add skills, employers, years, pay or reasons that are not there.
- State the verdict exactly as given ("verdict" field) — never warmer or colder. strong = strong fit, possible = possible fit, stretch = a stretch, not_a_fit = not a fit.
- If you mention how many requirements are covered, use exactly "mustCovered of mustTotal" from the ANALYSIS.
- Then the single most important reason, then the most useful next step (which gap to address, or what to check before applying).
- No flattery, no exclamation marks, no "great news". Second person ("you").
- Never state a number that is not in the ANALYSIS.`;

function summaryPrompt(fit: Omit<FitData, 'summary'>, jd: JdData, coverage: Coverage): string {
    const analysis = {
        role: jd.role,
        company: jd.company,
        verdict: fit.verdict,
        score: fit.score,
        mustCovered: coverage.mustCovered,
        mustTotal: coverage.mustTotal,
        matched: fit.matched.slice(0, 6).map((m) => ({ requirement: m.text, evidence: m.evidence })),
        gaps: fit.gaps.slice(0, 6).map((g) => ({ requirement: g.text, severity: g.severity })),
        preferences: fit.preferenceChecks,
        reasons: fit.notFitReasons,
    };
    return `ANALYSIS:\n${JSON.stringify(analysis, null, 2)}\n\nWrite the summary.`;
}

// ──────────────────────────────────────────────────────────────── section

export const fitSection: ScoutSection<'fit'> = async (ctx) => {
    const jd = dataOf(ctx.sections, 'jd');
    const ingest = dataOf(ctx.sections, 'ingest');
    if (!jd) return { status: 'unavailable', reason: 'No job description was extracted, so fit cannot be checked' };

    const { record, prefs } = await loader(ctx.userId);
    const jdText = ingest?.text ?? '';
    const plan = planMatching(jd, record);
    const match = await matchRequirements(ctx, plan, record);
    const evaluation = evaluateFit({
        jd,
        jdText,
        record,
        prefs,
        answers: ctx.answers,
        plan,
        judgements: match.judgements,
        softIds: match.softIds,
    });
    ctx.step.log('fit evaluated', {
        via: match.via,
        asked: plan.toAsk.length,
        prefiltered: plan.prefiltered.size,
        soft: evaluation.softRequirements.length,
        mustCovered: evaluation.coverage.mustCovered,
        mustTotal: evaluation.coverage.mustTotal,
        score: evaluation.fit.score,
        verdict: evaluation.fit.verdict,
    });

    let summary = deterministicSummary(evaluation.fit, jd, evaluation.coverage);
    // No prose while a question is open: the answer re-runs this section, so a
    // model summary now would be paid for and thrown away.
    if (!record.empty && !evaluation.question) {
        try {
            const { data, degraded } = await ctx.step.ai({
                task: 'scoutFitExplain',
                schema: SummarySchema,
                system: SYSTEM,
                prompt: summaryPrompt(evaluation.fit, jd, evaluation.coverage),
                maxRetries: 1,
                guard: {
                    // The computed fields are part of the source: the score and
                    // the counts are ours, and quoting them back is not fabrication.
                    sourceText: [
                        jdText,
                        record.lines.map((line) => line.text).join('\n'),
                        JSON.stringify({ ...evaluation.fit, ...evaluation.coverage }),
                    ].join('\n\n'),
                    fields: ['summary'],
                },
            });
            const written = data.summary.trim();
            if (written && !degraded && summaryAgrees(written, evaluation.fit.verdict, evaluation.coverage)) {
                summary = written;
            } else if (written) {
                ctx.step.log('model summary disagreed with the numbers; using the plain one', { written });
            }
        } catch (error) {
            ctx.step.log('summary fell back to deterministic', { error: String(error) });
        }
    }

    const fit: FitData = { ...evaluation.fit, summary };
    if (evaluation.question) {
        return { status: 'needs_input', question: evaluation.question, data: fit };
    }
    return { status: 'ok', data: fit };
};
