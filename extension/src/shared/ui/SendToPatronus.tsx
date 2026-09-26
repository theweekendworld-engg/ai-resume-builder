import { useState } from 'react';
import { ExternalLink, Loader2, Send } from 'lucide-react';
import { request } from '@/background/messageBus';
import { useAppBaseUrl } from '@/sidepanel/hooks/useAppBaseUrl';
import { trackExtensionEvent } from '@/shared/lib/telemetry';
import type { ScoutSendResultWire } from '@/shared/types/messages';
import { cn } from '@/shared/ui/cn';

type State =
    | { status: 'idle' }
    | { status: 'sending' }
    | { status: 'sent'; result: ScoutSendResultWire }
    | { status: 'paywall'; message: string }
    | { status: 'error'; message: string };

const KIND_LABEL: Record<string, string> = {
    linkedin_post: 'post',
    linkedin_job: 'job',
    linkedin_article: 'article',
    job_page: 'job',
    page: 'page',
};

function errorCopy(code: string): string {
    if (code === 'not_authenticated') return 'Connect your Patronus account first.';
    if (code === 'nothing_to_send') {
        return 'Could not find a post or job on this page. Open the post itself (click its timestamp) and try again.';
    }
    if (code === 'scout_not_available') return 'Scout is not switched on for your account yet.';
    return 'Could not send this page. Try again in a moment.';
}

async function activeTabId(): Promise<number | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}

/**
 * "Send to Patronus": hand this tab to Scout, which works out whether it is a
 * job, a hiring post, company news or something worth reading, and answers
 * accordingly. Shared by the side panel and the popup, so the two cannot
 * disagree about what sending does.
 */
export function SendToPatronus({ compact = false }: { compact?: boolean }) {
    const appBase = useAppBaseUrl();
    const [state, setState] = useState<State>({ status: 'idle' });

    const send = async () => {
        setState({ status: 'sending' });
        const tabId = await activeTabId();
        if (tabId == null) {
            setState({ status: 'error', message: errorCopy('nothing_to_send') });
            return;
        }
        const res = await request<ScoutSendResultWire>({ type: 'SCOUT_SEND', tabId });
        if (!res.ok) {
            if (res.error.startsWith('paywall:')) {
                trackExtensionEvent('scout.paywalled', {});
                setState({ status: 'paywall', message: res.error.slice('paywall:'.length) });
                return;
            }
            trackExtensionEvent('scout.failed', { reason: res.error.slice(0, 60) });
            setState({ status: 'error', message: errorCopy(res.error) });
            return;
        }
        trackExtensionEvent('scout.sent', {
            kindHint: res.data.sent.kindHint,
            method: res.data.sent.method,
            created: res.data.created,
            hasUrl: Boolean(res.data.sent.url),
        });
        setState({ status: 'sent', result: res.data });
    };

    return (
        <section className={cn('card text-xs', compact ? 'p-2' : 'p-3')}>
            {!compact && (
                <>
                    <p className="font-medium">Send to Patronus</p>
                    <p className="mt-1 text-muted-foreground">
                        Works on a LinkedIn post, a job, or an article. Patronus checks your fit and looks up
                        the company, pay, interview experiences and who to contact.
                    </p>
                </>
            )}

            <button
                type="button"
                onClick={send}
                disabled={state.status === 'sending'}
                className={cn('btn-primary w-full', !compact && 'mt-2')}
            >
                {state.status === 'sending' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                    <Send className="h-3.5 w-3.5" />
                )}
                {state.status === 'sending' ? 'Sending…' : 'Send this page to Patronus'}
            </button>

            {state.status === 'sent' && (
                <div className="mt-2 space-y-1">
                    <p className="font-medium text-foreground">{state.result.headline}</p>
                    <p className="text-muted-foreground">
                        {state.result.created
                            ? `Sent the ${KIND_LABEL[state.result.sent.kindHint] ?? 'page'}${state.result.sent.author ? ` by ${state.result.sent.author}` : ''}. The analysis takes about a minute.`
                            : 'You already sent this one. Here is the same analysis, at no extra cost.'}
                    </p>
                    <a
                        className="btn btn-outline w-full gap-1 text-xs"
                        href={state.result.dashboardUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Open in Patronus
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
            )}

            {state.status === 'paywall' && (
                <div className="mt-2">
                    {/* The server's own wording: it knows the plan and the limit. */}
                    <p className="text-muted-foreground">{state.message}</p>
                    <a
                        className="btn btn-outline mt-2 w-full gap-1 text-xs"
                        href={`${appBase}/settings/plan`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        See plans
                        <ExternalLink className="h-3 w-3" />
                    </a>
                </div>
            )}

            {state.status === 'error' && <p className="mt-2 text-destructive">{state.message}</p>}
        </section>
    );
}
