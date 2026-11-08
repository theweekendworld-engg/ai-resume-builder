/**
 * The apply chain's pure half: reading its state off a run and the facts each
 * transition is decided on (docs/impl/07-telegram-apply.md §5). The
 * transitions themselves are `src/services/applyChain.ts`.
 *
 * Every fact here is code's: the eligibility conflict is the fit's own stored
 * check, the apply address and URL come from the posting, and a label is the
 * JD's role and company. Nothing is written by a model.
 */

import { z } from 'zod';
import type { StoredSection } from '@/lib/agent/run';
import { applyEmailsOf } from '@/lib/drafts/applyEmail';
import { APPLY_STAGES, type ApplyChainState, type ApplyStage, type FitData, type JdData, type ScoutInput } from '@/lib/scout/types';

const ChainSchema = z.object({
    stage: z.enum(APPLY_STAGES),
    at: z.string(),
    override: z.boolean().optional(),
    sessionId: z.string().nullable().optional(),
    skipped: z.array(z.string()).optional(),
    draftId: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
});

/** The chain on a run's input, or null when the run has none (or it is unreadable). */
export function readApplyChain(input: unknown): ApplyChainState | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const parsed = ChainSchema.safeParse((input as { apply?: unknown }).apply);
    return parsed.success ? parsed.data : null;
}

/**
 * The chain as it should be read: a run whose goal is `apply` and that has no
 * chain yet is `pending` (the goal was set at start, before any transition).
 */
export function chainOf(input: Pick<ScoutInput, 'goal' | 'apply'> | null | undefined): ApplyChainState | null {
    if (!input || input.goal !== 'apply') return null;
    return readApplyChain(input) ?? { stage: 'pending', at: new Date(0).toISOString() };
}

/** Stages where the chain is working or done: "Apply for me" again would repeat it. */
export const ACTIVE_STAGES: ReadonlySet<ApplyStage> = new Set<ApplyStage>(['tailoring', 'drafting', 'drafted', 'applied']);

function okData<T>(section: StoredSection | undefined): T | null {
    return section && section.status === 'ok' ? (section.data as T) : null;
}

/**
 * The fit's blocking eligibility conflict ("You may not be eligible: requires
 * US citizenship…"), or null. Only a `conflict` blocks: an `unknown` that can
 * be asked is already the run's blocking question, and one that cannot is the
 * employer's call, which the fit says.
 */
export function eligibilityBlocker(sections: Record<string, StoredSection | undefined>): string | null {
    const fit = okData<FitData>(sections.fit);
    const check = fit?.preferenceChecks.find((entry) => entry.key === 'eligibility' && entry.status === 'conflict');
    if (!check) return null;
    const detail = check.detail.trim();
    return /^you may not be eligible/i.test(detail) ? detail : `You may not be eligible: ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`;
}

/** "Forward Deployed AI Engineer at iServeWorld", from the JD. */
export function roleAtCompany(sections: Record<string, StoredSection | undefined>): { role: string | null; company: string | null; label: string } {
    const jd = okData<JdData>(sections.jd);
    const role = jd?.role?.trim() || null;
    const company = jd?.company?.trim() || null;
    const label = role && company ? `${role} at ${company}` : role ?? company ?? 'this job';
    return { role, company, label };
}

/** Where to apply when there is no address to email: the posting's apply link, else the posting itself. */
export function applyUrlOf(sections: Record<string, StoredSection | undefined>, inputUrl: string | null | undefined): string | null {
    const jd = okData<JdData>(sections.jd);
    for (const candidate of [jd?.applyUrl, inputUrl]) {
        if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
    }
    return null;
}

export function hasApplyAddress(sections: Record<string, StoredSection | undefined>): boolean {
    return applyEmailsOf(sections).length > 0;
}

/** "MCP", "MCP or Claude", "MCP, Claude or LangGraph". */
export function orList(items: readonly string[]): string {
    const clean = [...new Set(items.map((item) => item.trim()).filter(Boolean))];
    if (clean.length <= 1) return clean[0] ?? '';
    return `${clean.slice(0, -1).join(', ')} or ${clean[clean.length - 1]}`;
}

/** The line about skills the skipped questions asked for, or null when none were. */
export function skippedSkillsLine(skipped: readonly string[] | undefined, format: 'email' | 'message'): string | null {
    const items = [...new Set((skipped ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 4);
    if (items.length === 0) return null;
    return `I didn't claim ${orList(items)} experience. Reply with details to add ${items.length === 1 ? 'it' : 'them'} to the ${format}.`;
}
