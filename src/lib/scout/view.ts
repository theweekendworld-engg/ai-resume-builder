/**
 * `AgentRun` row → what every surface renders. Pure, so the dashboard, the
 * Telegram message and the WhatsApp message cannot disagree about a run.
 */

import type { AgentRunRow, PendingQuestion, StoredSection } from '@/lib/agent/run';
import { planFor } from '@/lib/scout/plan';
import type {
    CaptureData,
    ClassifyData,
    FitData,
    IngestData,
    JdData,
    OutreachDraft,
    ScoutInput,
    ScoutKind,
    ScoutRunSummary,
    ScoutRunView,
    ScoutSections,
} from '@/lib/scout/types';

function sectionsOf(run: Pick<AgentRunRow, 'result'>): ScoutSections {
    const value = run.result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as unknown as ScoutSections;
}

function draftsOf(run: Pick<AgentRunRow, 'result'>): OutreachDraft[] {
    const value = run.result;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const drafts = (value as Record<string, unknown>).drafts;
    return Array.isArray(drafts) ? (drafts as OutreachDraft[]) : [];
}

function okData<T>(section: StoredSection | undefined): T | null {
    return section && section.status === 'ok' ? (section.data as T) : null;
}

const VERDICT_WORDS: Record<FitData['verdict'], string> = {
    strong: 'Strong fit',
    possible: 'Possible fit',
    stretch: 'Stretch',
    not_a_fit: 'Not a fit',
    unknown: 'Fit unclear',
};

/**
 * One line that says what this is and what we think, built from stored fields
 * only. No model: a headline that can drift from the sections under it is
 * worse than a plain one.
 */
export function buildHeadline(sections: ScoutSections, status: ScoutRunView['status'], error: string | null): string {
    const ingest = okData<IngestData>(sections.ingest);
    const classify = okData<ClassifyData>(sections.classify);
    const jd = okData<JdData>(sections.jd);
    const fit = okData<FitData>(sections.fit);

    if (status === 'failed' && error) return error;
    if (!classify) return ingest?.title ?? 'Reading your link…';

    switch (classify.kind) {
        case 'job_posting':
        case 'hiring_post': {
            const role = jd?.role || classify.roleTitle || ingest?.title || 'Role';
            const company = jd?.company || classify.companies[0] || ingest?.companyName;
            const what = company ? `${role} at ${company}` : role;
            if (!fit) return what;
            const score = fit.score === null ? '' : ` (${fit.score})`;
            return `${what} · ${VERDICT_WORDS[fit.verdict]}${score}`;
        }
        case 'company_signal':
            return classify.companies.length
                ? `Company news: ${classify.companies.slice(0, 3).join(', ')}`
                : 'Company news';
        case 'knowledge':
            return ingest?.title ? `Saved: ${ingest.title}` : 'Saved to your reading shelf';
        case 'work_note': {
            const capture = okData<CaptureData>(sections.capture);
            if (!capture) return 'Adding this to your Work Log…';
            return capture.status === 'merge_proposed'
                ? `Looks like a Win you already have: ${capture.title}`
                : `Work Log draft: ${capture.title}`;
        }
        case 'other':
            return 'Not something I can act on';
    }
}

export function toRunView(run: AgentRunRow): ScoutRunView {
    const sections = sectionsOf(run);
    const kind = (run.kind as ScoutKind | null) ?? null;
    return {
        id: run.id,
        status: run.status,
        kind,
        input: run.input as unknown as ScoutInput,
        channel: run.channel,
        sections,
        plan: planFor(kind),
        pendingQuestion: (run.pendingQuestion as unknown as PendingQuestion | null) ?? null,
        drafts: draftsOf(run),
        headline: buildHeadline(sections, run.status, run.error),
        createdAt: run.createdAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        error: run.error,
    };
}

export function toRunSummary(run: AgentRunRow): ScoutRunSummary {
    const view = toRunView(run);
    return {
        id: view.id,
        status: view.status,
        kind: view.kind,
        headline: view.headline,
        url: view.input.url ?? null,
        createdAt: view.createdAt,
    };
}
