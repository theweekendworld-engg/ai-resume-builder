import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, FileText, Loader2, Sparkles } from 'lucide-react';
import { request } from '@/background/messageBus';
import { usePageContext } from '../hooks/usePageContext';
import { useAppBaseUrl } from '../hooks/useAppBaseUrl';
import { trackExtensionEvent } from '@/shared/lib/telemetry';
import type { GenerationSessionWire } from '@/shared/types/messages';

/**
 * Tailor the user's resume against the job on screen.
 *
 * The generation backend has been real and metered for a long time; nothing in
 * the extension could reach it. This route is that connection.
 *
 * Two things drive the design:
 *
 * 1. **The panel owns the clock.** Generation runs for tens of seconds and an
 *    MV3 service worker can be evicted at any moment, so a poll loop living in
 *    the worker would simply stop. Polling here means the run survives worker
 *    eviction and stops the instant the panel closes.
 *
 * 2. **A quota refusal is not an error.** Tailoring is the metered feature that
 *    the Search tier exists to sell, so hitting the limit is an expected,
 *    designed state. It gets the server's own wording and a route to upgrade,
 *    never a red failure box.
 */

/** Terminal states — polling stops here. */
function isDone(status: GenerationSessionWire['status']): boolean {
    return status === 'completed' || status === 'failed';
}

const POLL_MS = 2000;
/**
 * Give up after five minutes. A run that has not finished by then is stuck,
 * and a spinner with no end is worse than an honest "check the app".
 */
const POLL_TIMEOUT_MS = 5 * 60_000;

export function TailorRoute() {
    const { state } = usePageContext();
    const appBase = useAppBaseUrl();
    const [session, setSession] = useState<GenerationSessionWire | null>(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paywall, setPaywall] = useState<string | null>(null);

    /** Set when the panel unmounts, so a poll in flight cannot set state after. */
    const cancelled = useRef(false);
    useEffect(() => {
        cancelled.current = false;
        return () => {
            cancelled.current = true;
        };
    }, []);

    const poll = useCallback(async (sessionId: string) => {
        const startedAt = Date.now();

        while (!cancelled.current) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            if (cancelled.current) return;

            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                setError('This is taking longer than expected. Check the web app for the result.');
                return;
            }

            const res = await request<{ session?: GenerationSessionWire }>({
                type: 'TAILOR_STATUS',
                sessionId,
            });
            if (cancelled.current) return;

            // A single failed poll is usually a blip, not a dead run — keep going.
            if (!res.ok || !res.data?.session) continue;

            const next = res.data.session;
            setSession(next);

            if (isDone(next.status)) {
                trackExtensionEvent('tailor.finished', {
                    status: next.status,
                    elapsedMs: next.elapsedMs,
                });
                return;
            }
        }
    }, []);

    const handleStart = async () => {
        if (state.status !== 'ready') return;
        const { pageModel } = state;

        setStarting(true);
        setError(null);
        setPaywall(null);
        setSession(null);

        const res = await request<{ session?: GenerationSessionWire }>({
            type: 'TAILOR_START',
            jobDescription: pageModel.jobDescription?.text,
            companyName: pageModel.metadata['companyName'] as string | undefined,
            roleTitle: (pageModel.metadata['roleTitle'] as string | undefined) ?? pageModel.heading,
            sourceUrl: pageModel.url,
        });
        setStarting(false);

        if (!res.ok) {
            if (res.error?.startsWith('paywall:')) {
                setPaywall(res.error.slice('paywall:'.length));
                trackExtensionEvent('tailor.paywalled', {});
                return;
            }
            setError(
                res.error === 'not_authenticated'
                    ? 'Connect your account in Settings to tailor your resume.'
                    : 'Could not start tailoring. Please try again.',
            );
            return;
        }

        const started = res.data?.session;
        if (!started) {
            setError('Could not start tailoring. Please try again.');
            return;
        }
        setSession(started);
        trackExtensionEvent('tailor.started', {});
        if (!isDone(started.status)) void poll(started.id);
    };

    // ── page has no job description to work from
    if (state.status !== 'ready') {
        return (
            <div className="card p-4 text-sm">
                <h3 className="mb-1 font-semibold">Tailor resume for this job</h3>
                <p className="text-muted-foreground">
                    Open a job posting and this will tailor your resume against it.
                </p>
            </div>
        );
    }

    const { pageModel } = state;
    const jd = pageModel.jobDescription;
    const roleTitle = (pageModel.metadata['roleTitle'] as string | undefined) ?? pageModel.heading;
    const companyName = pageModel.metadata['companyName'] as string | undefined;
    const running = Boolean(session) && !isDone(session!.status);

    return (
        <div className="space-y-2">
            <section className="card p-3">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Tailor for this job</h3>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    {roleTitle ?? 'This role'}
                    {companyName ? ` · ${companyName}` : ''}
                </p>

                {!jd ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                        No job description found on this page. Open the full posting and try again.
                    </p>
                ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                        Using the job description from this page
                        {jd.confidenceBand === 'low' ? ' (low confidence — check the result)' : ''}.
                    </p>
                )}

                <button
                    type="button"
                    className="btn btn-primary mt-3 w-full gap-1 text-xs"
                    disabled={!jd || starting || running}
                    onClick={() => void handleStart()}
                >
                    {starting || running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {starting ? 'Starting…' : running ? 'Tailoring…' : 'Tailor my resume'}
                </button>
            </section>

            {paywall ? (
                <section className="card p-3 text-xs">
                    <p className="font-medium">You have used your tailored resumes</p>
                    {/* The server's own wording — it knows the plan and the limit. */}
                    <p className="mt-1 text-muted-foreground">{paywall}</p>
                    <a
                        className="btn btn-outline mt-2 w-full gap-1 text-xs"
                        href={`${appBase}/settings/plan`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        See plans
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </section>
            ) : null}

            {error ? (
                <div className="card flex items-start gap-2 p-3 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            {session ? (
                <section className="card p-3">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">
                            {session.status === 'failed'
                                ? 'Tailoring failed'
                                : session.status === 'completed'
                                  ? 'Ready'
                                  : session.stageLabel}
                        </span>
                        <span className="text-muted-foreground">{session.progressPercent}%</span>
                    </div>

                    <div
                        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={session.progressPercent}
                        aria-label="Tailoring progress"
                    >
                        <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{ width: `${session.progressPercent}%` }}
                        />
                    </div>

                    {session.status === 'failed' ? (
                        <p className="mt-2 text-xs text-destructive">
                            {session.errorMessage ?? 'Something went wrong. Please try again.'}
                        </p>
                    ) : null}

                    {session.status === 'completed' ? (
                        <div className="mt-3 space-y-2">
                            {/*
                                What the resume answers, not a bare number.

                                This used to read "ATS score 71" and stop. The
                                number was keyword overlap, then it became
                                requirement coverage, and either way a figure
                                with nothing behind it tells someone nothing.
                                The panel is open on the job page with the
                                posting right there — the best moment anyone
                                gets to learn what they have not answered.
                            */}
                            {session.match ? (
                                <div className="rounded-md border border-border bg-card p-2.5">
                                    {typeof session.match.score === 'number' ? (
                                        <p className="text-xs">
                                            <span className="text-base font-semibold text-foreground">
                                                {session.match.score}
                                            </span>
                                            <span className="text-muted-foreground">
                                                /100 of what they asked for is answered
                                            </span>
                                        </p>
                                    ) : null}

                                    {session.match.unanswered.length > 0 ? (
                                        <div className="mt-2">
                                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                Not answered
                                            </p>
                                            <ul className="mt-1 space-y-0.5">
                                                {session.match.unanswered.map((item) => (
                                                    <li key={item} className="flex gap-1.5 text-xs text-foreground">
                                                        <span className="text-muted-foreground" aria-hidden>
                                                            ·
                                                        </span>
                                                        <span>{item}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : null}

                                    {session.match.skillGaps.length > 0 ? (
                                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                                            <span className="font-medium">
                                                {session.match.skillGaps.join(', ')}
                                            </span>{' '}
                                            {session.match.skillGaps.length === 1 ? 'is' : 'are'} named in
                                            the posting and not in your history, so{' '}
                                            {session.match.skillGaps.length === 1 ? 'it was' : 'they were'}{' '}
                                            left off.
                                        </p>
                                    ) : null}
                                </div>
                            ) : typeof session.atsScore === 'number' ? (
                                // Older sessions, and the v1 fallback, carry a
                                // score with no report behind it.
                                <p className="text-xs text-muted-foreground">
                                    Match score{' '}
                                    <span className="font-medium text-foreground">{session.atsScore}</span>
                                </p>
                            ) : null}
                            {session.pdfUrl ? (
                                <a
                                    className="btn btn-primary w-full gap-1 text-xs"
                                    href={session.pdfUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={() => trackExtensionEvent('tailor.pdf_opened', {})}
                                >
                                    Download PDF
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            ) : null}
                            {session.editorUrl ? (
                                <a
                                    className="btn btn-outline w-full gap-1 text-xs"
                                    href={session.editorUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    Open in editor
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
