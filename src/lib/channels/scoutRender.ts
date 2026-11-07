/**
 * Scout run → chat message. Pure: `ScoutRunView` in, `RichMessage` out.
 *
 * Written for a phone lock screen. The final message is the headline plus at
 * most five lines, in the order a candidate decides in: where and how, what it
 * pays, who the company is, what rules you out, how to prepare. Everything else
 * is one tap away on the dashboard.
 *
 * Every line is built from stored section data. Nothing here computes a new
 * number, and an unavailable section simply has no line — the dashboard is
 * where "why unavailable" is explained.
 */

import { topStrength } from '@/lib/scout/fit/strength';
import type { StoredSection } from '@/lib/agent/run';
import {
    SCOUT_SECTION_LABELS,
    type CaptureData,
    type ClassifyData,
    type CompData,
    type CompanyData,
    type DigestData,
    type FitData,
    type InterviewsData,
    type JdData,
    type NetworkData,
    type OpeningsData,
    type ScoutRunView,
    type ScoutSectionName,
    type TrackData,
} from '@/lib/scout/types';
import { COLUMN_LABELS, COLUMN_OF_STATUS } from '@/lib/inbox/types';
import type { Line, RichMessage, ScoutAction } from '@/lib/channels/types';
import { applyEmailsOf } from '@/lib/drafts/applyEmail';
import type { DraftView } from '@/lib/drafts/types';

export const MAX_KEY_LINES = 7;

export function scoutRunUrl(appUrl: string, runId: string): string {
    return `${appUrl.replace(/\/$/, '')}/scout/${runId}`;
}

function okData<T>(section: StoredSection | undefined): T | null {
    return section && section.status === 'ok' ? (section.data as T) : null;
}

function footerFor(view: ScoutRunView, appUrl: string): Line {
    if (view.kind === 'work_note') {
        const url = `${appUrl.replace(/\/$/, '')}/log`;
        return [{ text: 'Work Log: ' }, { text: url, href: url }];
    }
    const url = scoutRunUrl(appUrl, view.id);
    return [{ text: 'Full analysis: ' }, { text: url, href: url }];
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

// ─────────────────────────────────────────────────────────────── progress

type StepMark = '✓' | '…' | '—' | '?';

export function markFor(section: StoredSection | undefined, runActive: boolean): StepMark {
    if (!section) return runActive ? '…' : '—';
    switch (section.status) {
        case 'ok':
            return '✓';
        case 'needs_input':
            return '?';
        default:
            return '—';
    }
}

export function renderScoutProgress(view: ScoutRunView, appUrl: string): RichMessage {
    const active = view.status === 'queued' || view.status === 'running';
    const lines: Line[] = [[{ text: active ? '🔎 ' : '', bold: false }, { text: view.headline, bold: true }], []];
    for (const name of view.plan) {
        const section = view.sections[name as ScoutSectionName];
        lines.push([{ text: `${markFor(section as StoredSection | undefined, active)} ${SCOUT_SECTION_LABELS[name]}` }]);
    }
    return { lines, footer: footerFor(view, appUrl), actions: [] };
}

// ────────────────────────────────────────────────────────────────── final

function shortLine(value: string, max: number): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '')}…`;
}

function jobLines(view: ScoutRunView): Line[] {
    const jd = okData<JdData>(view.sections.jd);
    const fit = okData<FitData>(view.sections.fit);
    const comp = okData<CompData>(view.sections.comp);
    const company = okData<CompanyData>(view.sections.company);
    const interviews = okData<InterviewsData>(view.sections.interviews);
    const network = okData<NetworkData>(view.sections.network);
    const lines: Line[] = [];

    if (jd) {
        const where = [jd.location, jd.workMode !== 'unknown' ? jd.workMode : null].filter(Boolean).join(' · ');
        if (where) lines.push([{ text: `📍 ${where}` }]);
    }

    const figure = comp?.figures[0];
    if (figure) {
        lines.push([
            { text: '💰 ' },
            { text: figure.value, bold: true },
            { text: ` ${figure.label} (${hostOf(figure.sourceUrl)})` },
        ]);
    } else if (jd?.compensationText) {
        lines.push([{ text: '💰 Listed: ' }, { text: jd.compensationText, bold: true }]);
    }

    if (company) {
        const size = company.employeeCountRange
            ? `${company.employeeCountRange} employees`
            : company.employeeCount
                ? `~${company.employeeCount.toLocaleString('en-US')} employees`
                : null;
        const money = company.fundingText ?? company.latestFundingStage ?? company.revenueText;
        const parts = [size, money].filter(Boolean);
        if (parts.length) {
            lines.push([{ text: `🏢 ${company.name}: ${parts.join(' · ')}` }]);
        } else if (company.facts[0]) {
            // No provider record: the first cited fact, with where it came from.
            const fact = company.facts[0];
            lines.push([{ text: `🏢 ${company.name}: ${fact.label} ${fact.value} (${hostOf(fact.sourceUrl)})` }]);
        }
    }

    if (fit) {
        // The strongest direct match first: a verdict with only negatives
        // hides the thing that decides whether to apply anyway.
        const strength = topStrength(fit.matched);
        // What the user DID, not the posting's wording of it: "Built a
        // hybrid search engine in Go" says more than "Expertise in one or
        // more programming languages".
        if (strength) lines.push([{ text: `✅ ${shortLine(strength.evidence || strength.text, 90)}` }]);
        const reason = fit.notFitReasons[0]
            ?? fit.gaps.find((gap) => gap.severity === 'blocking')?.text
            ?? fit.gaps[0]?.text;
        if (reason) {
            const prefix = fit.notFitReasons[0] ? '⚠️ ' : '⚠️ Gap: ';
            lines.push([{ text: `${prefix}${reason}` }]);
        }
    }

    if (interviews && interviews.links.length > 0) {
        const n = interviews.links.length;
        lines.push([{ text: `🎤 ${n} interview experience${n === 1 ? '' : 's'} found` }]);
    }

    if (network && network.targets.length > 0) {
        const n = network.targets.length;
        lines.push([{ text: `🤝 ${n} ${n === 1 ? 'person' : 'people'} worth reaching out to` }]);
    }

    // Where it now lives. Last, and kept even when the key lines are full:
    // "is this saved anywhere?" is the question behind every share.
    const kept = lines.slice(0, MAX_KEY_LINES);
    const tracked = trackLine(view);
    if (tracked) kept.push(tracked);
    return kept;
}

export function trackLine(view: ScoutRunView): Line | null {
    const track = okData<TrackData>(view.sections.track);
    if (!track) return null;
    if (track.created || COLUMN_OF_STATUS[track.status] === 'to_review') {
        return [{ text: '📋 Saved to your job tracker · /jobs to see your best fits' }];
    }
    return [{ text: `📋 Already in your tracker: ${COLUMN_LABELS[COLUMN_OF_STATUS[track.status]]}` }];
}

function knowledgeLines(view: ScoutRunView): Line[] {
    const digest = okData<DigestData>(view.sections.digest);
    if (!digest) return [];
    return [
        ...digest.takeaways.slice(0, 3).map((takeaway) => [{ text: `• ${takeaway}` }]),
        [],
        [{ text: digest.savedInsightId ? '📚 Saved to your Insights shelf · /insights' : '📚 Takeaways above; not saved to your shelf' }],
    ];
}

/** A Work Log draft from a note, or why there is not one. */
function noteLines(view: ScoutRunView): Line[] {
    const section = view.sections.capture;
    if (!section) return [];
    if (section.status !== 'ok') {
        const reason = 'reason' in section ? section.reason : null;
        return reason ? [[{ text: reason }]] : [];
    }
    const capture = section.data as CaptureData;
    if (capture.status === 'merge_proposed') {
        return [
            [{ text: 'This looks like a Win you already logged, so I did not add a second one.' }],
            [{ text: 'Open it to merge in anything new.', italic: true }],
        ];
    }
    const narrative = capture.narrative.split('\n').map((line) => line.trim()).find(Boolean);
    const lines: Line[] = [
        [{ text: '📝 ' }, { text: capture.title, bold: true }],
        [{ text: `${capture.category}${capture.skills.length ? ` · ${capture.skills.slice(0, 4).join(', ')}` : ''}` }],
    ];
    if (narrative) lines.push([{ text: narrative.length > 200 ? `${narrative.slice(0, 199)}…` : narrative }]);
    if (capture.degraded) lines.push([{ text: 'I left out a number your note did not state.', italic: true }]);
    lines.push([], [{ text: 'Draft in your Work Log. Confirm to keep it as evidence.', italic: true }]);
    return lines;
}

function logUrl(appUrl: string, winId?: string | null): string {
    const base = `${appUrl.replace(/\/$/, '')}/log`;
    return winId ? `${base}?win=${encodeURIComponent(winId)}` : base;
}

function noteActions(view: ScoutRunView, appUrl: string): ScoutAction[] {
    const capture = okData<CaptureData>(view.sections.capture);
    if (!capture) return [];
    if (capture.status === 'merge_proposed') {
        return [{ kind: 'open', label: 'Open in Work Log', url: logUrl(appUrl, capture.duplicateOfWinId ?? capture.winId) }];
    }
    return [
        { kind: 'confirm_win', winId: capture.winId, label: '✅ Confirm' },
        { kind: 'open', label: '✏️ Edit', url: logUrl(appUrl, capture.winId) },
        { kind: 'dismiss_win', winId: capture.winId, label: '🗑 Dismiss' },
    ];
}

function signalLines(view: ScoutRunView): Line[] {
    const openings = okData<OpeningsData>(view.sections.openings);
    const saved: Line = [{ text: '🏢 Recorded under Companies in your inbox' }];
    if (!openings) return [saved];
    return [...openings.companies.slice(0, 3).map((company): Line => {
        const n = company.openings.length;
        const detail = n > 0
            ? `${n} open role${n === 1 ? '' : 's'}${company.openings[0] ? `, e.g. ${company.openings[0].title}` : ''}`
            : company.note ?? 'no matching openings found';
        return [{ text: `🏢 ${company.name}: `, bold: false }, { text: detail }];
    }), [], saved];
}

function isJob(view: ScoutRunView): boolean {
    return view.kind === 'job_posting' || view.kind === 'hiring_post';
}

/** Telegram's button label cap (`TELEGRAM_LIMITS.maxButtonLabel`): a cut address is a guess. */
const EMAIL_LABEL_MAX = 40;

/**
 * "✉️ Email jobs@x.com" when the posting names where to apply, else a plain
 * "✉️ Draft email". The address is read by code from the posting
 * (`applyEmailsOf`); the button only names it. The draft's To is set from
 * the same read when the draft is written (`src/services/drafts.ts`).
 */
export function emailDraftAction(view: ScoutRunView): { action: Extract<ScoutAction, { kind: 'draft' }>; hasAddress: boolean } {
    const address = applyEmailsOf(view.sections)[0] ?? null;
    const named = address ? `✉️ Email ${address}` : null;
    return {
        action: {
            kind: 'draft',
            // The poster asked for the email; on a posting, an apply inbox is a recruiter's.
            target: view.kind === 'hiring_post' ? 'p' : 'r',
            format: 'e',
            label: named && [...named].length <= EMAIL_LABEL_MAX ? named : address ? '✉️ Email your application' : '✉️ Draft email',
        },
        hasAddress: Boolean(address),
    };
}

function jobActions(view: ScoutRunView, appUrl: string): ScoutAction[] {
    // Status first: one row of three on Telegram, the first choices of the
    // list on WhatsApp. Moving a job along is the most common next step.
    const actions: ScoutAction[] = [
        { kind: 'status', status: 's', label: '💾 Save' },
        { kind: 'status', status: 'a', label: '📨 Applied' },
        { kind: 'status', status: 'n', label: '❌ Not interested' },
    ];
    // The JD is already stored: tailoring is one tap, not a copy-paste into /build.
    actions.push({ kind: 'tailor', label: '✍️ Tailor resume' });
    // Telegram shows the first six (TELEGRAM_LIMITS.maxButtons), so order is
    // priority. A posting that names its apply address makes the email THE
    // way to apply: it comes straight after tailoring. Without an address it
    // is one option among several and goes after the existing ones, ahead of
    // only the "Open" link, which the footer repeats.
    const email = emailDraftAction(view);
    if (email.hasAddress) actions.push(email.action);
    const fit = okData<FitData>(view.sections.fit);
    const poster = view.kind === 'hiring_post';
    actions.push(poster
        ? { kind: 'draft', target: 'p', format: 'm', label: 'Draft message to poster' }
        : { kind: 'draft', target: 'f', format: 'n', label: 'Draft referral note' });
    if (fit && (fit.verdict === 'not_a_fit' || fit.verdict === 'stretch')) {
        actions.push({ kind: 'why', label: 'Why not a fit' });
    }
    if (!email.hasAddress) actions.push(email.action);
    actions.push({ kind: 'open', label: 'Open in Patronus', url: scoutRunUrl(appUrl, view.id) });
    return actions;
}

// ────────────────────────────────────────────────────────────────── drafts

/** Where a draft's buttons point. Built by `src/lib/drafts/render.ts`, which holds the signing key. */
export type DraftLinks = {
    /** Gmail web compose (https), prefilled. */
    gmail: string | null;
    /** The signed `/api/compose/<id>` route, which redirects to `mailto:`. */
    mailApp: string | null;
};

const DRAFT_TITLE: Record<DraftView['format'], string> = {
    email: '✉️ Email draft',
    linkedin_message: '💬 LinkedIn message draft',
    linkedin_note: '💬 LinkedIn note draft',
};

export const DRAFT_EDIT_HINT = 'Reply with any change, like "add IIT Delhi". I\'ll edit this draft.';
export const DRAFT_ATTACH_HINT = 'Attach your tailored resume PDF before you send. Patronus never sends email for you.';

/**
 * A draft version as a chat message: To / Subject / Body as plain text, the
 * compose links and the two fixed revisions. Pure: the links come in.
 *
 * Telegram gets the links as URL buttons. WhatsApp reply messages cannot
 * carry URL buttons, so there they travel in the text.
 */
export function renderDraftMessage(draft: DraftView, links: DraftLinks, channel: 'telegram' | 'whatsapp' = 'telegram'): RichMessage {
    const email = draft.format === 'email';
    const lines: Line[] = [[{ text: DRAFT_TITLE[draft.format] ?? 'Draft', bold: true }, { text: ` · v${draft.version}` }], []];
    if (email) {
        lines.push([{ text: 'To: ', bold: true }, { text: draft.toEmail ?? '(add the address in your mail app)' }]);
        lines.push([{ text: 'Subject: ', bold: true }, { text: draft.subject ?? '' }]);
        lines.push([]);
    }
    for (const paragraph of draft.body.split('\n')) lines.push([{ text: paragraph }]);
    lines.push([], [{ text: DRAFT_EDIT_HINT, italic: true }]);
    if (email) lines.push([{ text: DRAFT_ATTACH_HINT, italic: true }]);

    const actions: ScoutAction[] = [];
    if (email && channel === 'telegram') {
        if (links.gmail) actions.push({ kind: 'open', label: '📨 Open in Gmail to send', url: links.gmail });
        if (links.mailApp) actions.push({ kind: 'open', label: '📱 Mail app', url: links.mailApp });
    }
    if (email && channel === 'whatsapp') {
        const url = links.mailApp ?? links.gmail;
        if (url) lines.push([], [{ text: 'Open it in your mail app: ' }, { text: url, href: url }]);
    }
    actions.push(
        { kind: 'revise_draft', draftId: draft.id, revision: 's', label: '✂️ Shorter' },
        { kind: 'revise_draft', draftId: draft.id, revision: 'g', label: '💪 Stronger' },
    );
    return { lines, actions };
}

export function renderScoutFinal(view: ScoutRunView, appUrl: string): RichMessage {
    const footer = footerFor(view, appUrl);
    const headline: Line = [{ text: view.headline, bold: true }];

    if (view.status === 'failed') {
        const reason = view.error && view.error !== view.headline ? view.error : null;
        return {
            lines: [headline, ...(reason ? [[{ text: reason }]] : []), [{ text: 'You can paste the post text instead.' }]],
            footer,
            actions: [],
        };
    }

    const body: Line[] = isJob(view)
        ? jobLines(view)
        : view.kind === 'knowledge'
            ? knowledgeLines(view)
            : view.kind === 'company_signal'
                ? signalLines(view)
                : view.kind === 'work_note'
                    ? noteLines(view)
                    : (() => {
                    const classify = okData<ClassifyData>(view.sections.classify);
                    return classify?.reason ? [[{ text: classify.reason }]] : [];
                })();

    if (view.status === 'awaiting_input' && view.pendingQuestion) {
        const question = view.pendingQuestion;
        const actions: ScoutAction[] = (question.options ?? []).map((option, index) => ({
            kind: 'answer' as const,
            index,
            label: option.label,
        }));
        return {
            lines: [headline, ...body, [], [{ text: '❓ ', bold: false }, { text: question.prompt, bold: true }],
                ...(actions.length ? [] : [[{ text: 'Reply here with your answer.', italic: true }]])],
            footer,
            actions,
        };
    }

    return {
        lines: [headline, ...(body.length ? [[] as Line, ...body] : [])],
        footer,
        actions: isJob(view) ? jobActions(view, appUrl) : view.kind === 'work_note' ? noteActions(view, appUrl) : [],
    };
}
