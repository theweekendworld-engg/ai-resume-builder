import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createHash } from 'node:crypto';
import { WinStatus } from '@prisma/client';
import { checkWinTokenRateLimit } from '@/lib/rateLimit';
import { getAppUrl } from '@/lib/email/send';
import { track } from '@/lib/track';
import { prisma } from '@/lib/prisma';
import {
    resolveWinToken,
    verifyWinToken,
    type ApplyOutcome,
    type ResolveFailureReason,
} from '@/lib/winTokens';
import { UndoForm } from '@/components/notifications/UndoForm';
import { ApplyLinkForm } from '@/components/notifications/ApplyLinkForm';

/**
 * `/w/[token]` — the magic-link landing (design/02 §K4, PRD 01 §9.3).
 *
 * Logged out, mobile first, one screen: the Win and ONE button.
 *
 * The GET writes nothing. It used to perform the confirm itself, which was
 * safe only while the route was (accidentally) behind the login wall. Public,
 * every mail-security scanner that opens links would confirm Wins nobody
 * tapped, and confirming writes Evidence (CLAUDE.md rule 5). The tap calls
 * `applyFromDigestLink`, which re-verifies the token; the ledger in
 * `src/lib/winTokens.ts` still makes a double tap converge.
 *
 * `force-dynamic`: the page reflects the Win's current state.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata = {
    title: 'Patronus',
    robots: { index: false, follow: false },
};

const FAILURE_COPY: Record<ResolveFailureReason, { headline: string; detail: string }> = {
    not_configured: {
        headline: 'Something is off on our end',
        detail: 'This link cannot be checked right now. Open your log and confirm it there.',
    },
    invalid: {
        headline: 'That link did not work',
        detail: 'It may have been cut in half by your mail client. Open your log and confirm it there.',
    },
    unknown_digest: {
        headline: 'That link did not work',
        detail: 'It does not match any digest we sent. Open your log and confirm it there.',
    },
    expired: {
        headline: 'That link has expired',
        detail: 'Digest links last 30 days. The win is still waiting in your log.',
    },
    out_of_scope: {
        headline: 'That link did not work',
        detail: 'It points at something that was not in this digest. Open your log and confirm it there.',
    },
    win_missing: {
        headline: 'That one is gone',
        detail: 'The win this link pointed at has since been deleted.',
    },
};

export default async function MagicLinkPage({
    params,
    searchParams,
}: {
    params: Promise<{ token: string }>;
    searchParams: Promise<{ undone?: string }>;
}) {
    const { token } = await params;
    const query = await searchParams;
    const appUrl = getAppUrl();

    // Rate limit BEFORE any database work. Keyed on the digest root when the
    // signature checks out, and on a hash of the raw string when it does not,
    // so a brute-force sweep cannot spend our database on invalid tokens.
    const parsed = verifyWinToken(token);
    const limiterKey = parsed?.root ?? `bad:${createHash('sha256').update(String(token)).digest('hex').slice(0, 16)}`;
    const limit = await checkWinTokenRateLimit(limiterKey);
    if (!limit.allowed) {
        return (
            <Shell headline="Slow down a second" tone="neutral">
                <p className="text-sm text-muted-foreground">{limit.error}</p>
                <LogLink appUrl={appUrl} />
            </Shell>
        );
    }

    const resolved = await resolveWinToken(token);
    if (!resolved.ok) {
        const copy = FAILURE_COPY[resolved.reason];
        return (
            <Shell headline={copy.headline} tone="neutral">
                <p className="text-sm text-muted-foreground">{copy.detail}</p>
                <LogLink appUrl={appUrl} />
            </Shell>
        );
    }

    const { digest, win, payload } = resolved.resolved;

    // A click is the strongest open signal there is, and it is the one the
    // auto-degrade guardrail reads (PRD 01 §5.2).
    await markOpened(digest.id);

    // `edit` writes nothing — it is a signed deep link, and the app's own auth
    // takes over from here.
    if (payload.action === 'edit') {
        redirect(`${appUrl}/log?win=${encodeURIComponent(win.id)}&src=digest`);
    }

    // Already done (in the app, or an earlier tap)? Say so, with undo.
    // Otherwise show the Win and the one button that performs the action.
    const action = payload.action === 'dismiss' ? 'dismiss' : 'confirm';
    const alreadyDone = (action === 'confirm' && win.status === WinStatus.confirmed)
        || (action === 'dismiss' && win.status === WinStatus.dismissed);
    if (!alreadyDone && query.undone !== '1') {
        return (
            <Shell headline={action === 'confirm' ? 'Log this win?' : 'Not a win?'} tone="neutral">
                <p className="mt-3 text-balance text-lg font-medium leading-snug text-foreground">{win.title}</p>
                <ApplyLinkForm token={token} action={action} />
                <LogLink appUrl={appUrl} />
            </Shell>
        );
    }

    const outcome: Exclude<ApplyOutcome, { outcome: 'failed' }> = {
        outcome: 'already_done',
        action,
        win: { id: win.id, title: win.title, status: win.status },
    };
    const undone = query.undone === '1';
    const view = describeOutcome(outcome, undone);

    return (
        <Shell headline={view.headline} tone={view.tone}>
            <p className="mt-3 text-balance text-lg font-medium leading-snug text-foreground">{win.title}</p>

            {view.note ? <p className="mt-2 text-sm text-muted-foreground">{view.note}</p> : null}

            {view.canUndo ? (
                <div className="mt-6 text-sm text-muted-foreground">
                    <span>Was this you? </span>
                    <UndoForm token={token} />
                </div>
            ) : null}

            <LogLink appUrl={appUrl} />

            <p className="mt-8 text-xs text-muted-foreground">
                Signed in on this device?{' '}
                <Link href={`${appUrl}/log`} className="underline underline-offset-2">
                    Open Patronus
                </Link>
            </p>
        </Shell>
    );
}

// ---------------------------------------------------------------------------

type OutcomeView = {
    headline: string;
    tone: 'positive' | 'neutral';
    note: string | null;
    canUndo: boolean;
};

/** Copy per §K4. "Logged" for a confirm, and never an error for a replay. */
function describeOutcome(
    outcome: Exclude<ApplyOutcome, { outcome: 'failed' }>,
    undone: boolean,
): OutcomeView {
    if (undone) {
        return {
            headline: 'Undone',
            tone: 'neutral',
            note: 'It is back in your drafts — nothing was lost.',
            canUndo: false,
        };
    }

    if (outcome.outcome === 'navigate') {
        return { headline: 'Opening your log', tone: 'neutral', note: null, canUndo: false };
    }

    const confirmed = outcome.win.status === WinStatus.confirmed;
    const replay = outcome.outcome === 'already_done';

    return {
        headline: confirmed ? '✓  Logged' : 'Not a win',
        tone: confirmed ? 'positive' : 'neutral',
        note: replay
            ? confirmed
                ? 'You already logged this one.'
                : 'You already told us this was not a win.'
            : confirmed
              ? null
              : 'It will not show up in your log.',
        canUndo: true,
    };
}

async function markOpened(digestId: string): Promise<void> {
    try {
        const updated = await prisma.weeklyDigest.updateMany({
            where: { id: digestId, openedAt: null },
            data: { openedAt: new Date() },
        });
        if (updated.count === 1) {
            const digest = await prisma.weeklyDigest.findUnique({
                where: { id: digestId },
                select: { userId: true, channel: true, winIds: true },
            });
            if (digest) {
                await track(digest.userId, 'digest_opened', {
                    feature: 'work_log',
                    digestId,
                    channel: digest.channel,
                    winCount: Array.isArray(digest.winIds) ? digest.winIds.length : 0,
                });
            }
        }
    } catch (error: unknown) {
        // Telemetry must never break the action the user actually came for.
        console.warn('[w] could not record digest open', error);
    }
}

function LogLink({ appUrl }: { appUrl: string }) {
    return (
        <Link
            href={`${appUrl}/log`}
            className="mt-8 inline-flex h-11 min-w-[200px] items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground"
        >
            See your full log →
        </Link>
    );
}

function Shell({
    headline,
    tone,
    children,
}: {
    headline: string;
    tone: 'positive' | 'neutral';
    children: React.ReactNode;
}) {
    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
            <div className="w-full max-w-md text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Patronus</p>
                <h1
                    className={`mt-6 text-2xl font-semibold tracking-tight ${
                        tone === 'positive' ? 'text-foreground' : 'text-foreground'
                    }`}
                >
                    {headline}
                </h1>
                {children}
            </div>
        </main>
    );
}
