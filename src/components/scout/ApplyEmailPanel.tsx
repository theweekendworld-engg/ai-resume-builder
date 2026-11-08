'use client';

import * as React from 'react';
import Link from 'next/link';
import { Check, Copy, Download, FileText, Loader2, Mail, MailOpen, Minimize2, Send, Sparkles } from 'lucide-react';

import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { markApplyEmailOpened, reviseApplyEmail, startApplyEmail, getApplyEmailState, type ApplyDraftVersion, type ApplyEmailState } from '@/actions/drafts';
import { revisionLabel } from '@/lib/drafts/history';

import { EntitlementNotice } from './EntitlementNotice';

type Busy = null | 'start' | 'shorter' | 'stronger' | 'custom';

/** Shown under every email draft, as on Telegram. */
export const ATTACH_NOTE = 'Attach your tailored resume PDF before you send. Patronus never sends email for you.';

/**
 * Apply by email, on the web job page: the posting gives an address
 * ("send resumes to jobs@…"), so the email is THE way to apply.
 *
 * The same versioned drafts as Telegram (`src/services/drafts.ts`): v1 from
 * the record, then Shorter, Stronger or the user's own words, each a new
 * version. The To is the posting's own address, read by code. Open in Gmail
 * and Mail app prefill the user's own client; nothing is sent from here.
 */
export function ApplyEmailPanel({ runId, initial }: { runId: string; initial: ApplyEmailState }) {
    const [state, setState] = React.useState(initial);
    const [viewing, setViewing] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState<Busy>(null);
    const [error, setError] = React.useState<{ message: string; entitlement: boolean } | null>(null);
    const [instruction, setInstruction] = React.useState('');
    const [copied, setCopied] = React.useState(false);
    const inputId = React.useId();

    // A resume tailored in another tab, or above, shows up here when the user comes back.
    React.useEffect(() => {
        const refresh = () => {
            if (document.visibilityState !== 'visible') return;
            void getApplyEmailState(runId).then((next) => {
                if (next.success) setState((current) => ({ ...current, attachment: next.data.attachment }));
            }).catch(() => undefined);
        };
        // ...and the moment the tailor above finishes, on this same page.
        const onTailored = (event: Event) => {
            if ((event as CustomEvent<{ runId: string }>).detail?.runId === runId) refresh();
        };
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('patronus:tailored', onTailored);
        return () => {
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('patronus:tailored', onTailored);
        };
    }, [runId]);

    const latest = state.versions.at(-1) ?? null;
    const shown: ApplyDraftVersion | null = state.versions.find((version) => version.id === viewing) ?? latest;
    const address = latest?.toEmail ?? state.applyEmails[0] ?? null;
    if (!address && !latest) return null;

    const run = async (kind: Exclude<Busy, null>, work: () => Promise<Awaited<ReturnType<typeof startApplyEmail>>>) => {
        setBusy(kind);
        setError(null);
        const result = await work();
        setBusy(null);
        if (!result.success) {
            setError({ message: result.error, entitlement: result.code === 'entitlement_required' || result.code === 'usage_limit' });
            return false;
        }
        setState(result.data);
        setViewing(null);
        return true;
    };

    const start = () => run('start', () => startApplyEmail({ runId }));
    const revise = (revision: 'shorter' | 'stronger') => latest && run(revision, () => reviseApplyEmail({ draftId: latest.id, revision }));
    const custom = async (event: React.FormEvent) => {
        event.preventDefault();
        const text = instruction.trim();
        if (!latest || !text) return;
        if (await run('custom', () => reviseApplyEmail({ draftId: latest.id, instruction: text }))) setInstruction('');
    };
    const opened = (via: 'gmail' | 'mail') => {
        if (shown) void markApplyEmailOpened({ draftId: shown.id, via }).catch(() => undefined);
    };
    const copy = async () => {
        if (!shown) return;
        try {
            await navigator.clipboard.writeText([shown.subject ? `Subject: ${shown.subject}` : null, shown.body].filter(Boolean).join('\n\n'));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch {
            setCopied(false);
        }
    };

    const others = state.applyEmails.filter((email) => email !== address);

    return (
        <section className="surface-work rounded-xl border border-border bg-card p-5" aria-labelledby={`${inputId}-title`} aria-live="polite">
            <header className="flex flex-wrap items-start justify-between gap-2">
                <h2 id={`${inputId}-title`} className={cn(typeStyles.h3, 'flex items-center gap-2 text-foreground')}>
                    <Mail aria-hidden className="size-4 text-muted-foreground" strokeWidth={1.5} />
                    Apply by email
                </h2>
                {state.versions.length > 0 ? (
                    <div role="group" aria-label="Versions" className="flex flex-wrap gap-1">
                        {state.versions.map((version) => (
                            <button
                                key={version.id}
                                type="button"
                                aria-pressed={shown?.id === version.id}
                                title={revisionLabel(version)}
                                onClick={() => setViewing(version.id === latest?.id ? null : version.id)}
                                className={cn(
                                    typeStyles.caption,
                                    'num rounded-md border px-2 py-0.5',
                                    shown?.id === version.id ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                                )}
                            >
                                v{version.version}
                            </button>
                        ))}
                    </div>
                ) : null}
            </header>

            {!shown ? (
                <div className="mt-3">
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                        The posting asks for applications at <span className="text-foreground">{address}</span>. Patronus writes the email from your record; you send it from your own mail.
                    </p>
                    <Button className="mt-4 gap-1.5" onClick={start} disabled={busy !== null}>
                        {busy === 'start' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
                        Email {address}
                    </Button>
                </div>
            ) : (
                <div className="mt-3">
                    <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
                        v{shown.version} · {revisionLabel(shown)}
                    </p>
                    <dl className="mt-2 divide-y divide-border rounded-lg border border-border">
                        <div className="flex gap-3 px-3 py-2">
                            <dt className={cn(typeStyles.small, 'w-16 shrink-0 text-muted-foreground')}>To</dt>
                            <dd className={cn(typeStyles.small, 'min-w-0 break-all text-foreground')}>{shown.toEmail ?? 'Add the address in your mail app'}</dd>
                        </div>
                        <div className="flex gap-3 px-3 py-2">
                            <dt className={cn(typeStyles.small, 'w-16 shrink-0 text-muted-foreground')}>Subject</dt>
                            <dd className={cn(typeStyles.small, 'min-w-0 text-foreground')}>{shown.subject ?? ''}</dd>
                        </div>
                        <div className="px-3 py-3">
                            <dt className="sr-only">Body</dt>
                            <dd className={cn(typeStyles.body, 'whitespace-pre-wrap text-foreground')}>{shown.body}</dd>
                        </div>
                    </dl>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {shown.links.gmail ? (
                            <Button asChild size="sm" className="gap-1.5">
                                <a href={shown.links.gmail} target="_blank" rel="noopener noreferrer" onClick={() => opened('gmail')}>
                                    <MailOpen aria-hidden className="size-3.5" />
                                    Open in Gmail
                                </a>
                            </Button>
                        ) : null}
                        {shown.links.mailto ? (
                            <Button asChild size="sm" variant="outline" className="gap-1.5">
                                <a href={shown.links.mailto} onClick={() => opened('mail')}>
                                    <Mail aria-hidden className="size-3.5" />
                                    Mail app
                                </a>
                            </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="ghost" className="gap-1.5" onClick={copy}>
                            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
                            {copied ? 'Copied' : 'Copy'}
                        </Button>
                    </div>

                    {shown.id !== latest?.id ? (
                        <p className={cn(typeStyles.small, 'mt-3 text-muted-foreground')}>
                            Viewing v{shown.version}. Changes apply to the latest, v{latest?.version}.{' '}
                            <button type="button" className="underline hover:text-foreground" onClick={() => setViewing(null)}>
                                Back to v{latest?.version}
                            </button>
                        </p>
                    ) : null}

                    <div className="mt-4 border-t border-border pt-4">
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void revise('shorter')} disabled={busy !== null}>
                                {busy === 'shorter' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Minimize2 aria-hidden className="size-3.5" />}
                                Shorter
                            </Button>
                            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => void revise('stronger')} disabled={busy !== null}>
                                {busy === 'stronger' ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Sparkles aria-hidden className="size-3.5" />}
                                Stronger
                            </Button>
                        </div>
                        <form onSubmit={custom} className="mt-3 flex gap-2">
                            <label htmlFor={inputId} className="sr-only">Tell me what to change</label>
                            <Input
                                id={inputId}
                                value={instruction}
                                onChange={(event) => setInstruction(event.target.value)}
                                placeholder="Tell me what to change, e.g. mention my MCP work"
                                maxLength={500}
                                disabled={busy !== null}
                            />
                            <Button type="submit" size="sm" className="h-10 shrink-0" disabled={busy !== null || !instruction.trim()}>
                                {busy === 'custom' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                                Change
                            </Button>
                        </form>
                        {others.length ? (
                            <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>
                                The posting also lists {others.join(', ')}. To send it there, say &ldquo;send it to {others[0]}&rdquo;.
                            </p>
                        ) : null}
                    </div>
                </div>
            )}

            <AttachmentNote attachment={state.attachment} />

            {error ? (
                error.entitlement ? (
                    <div className="mt-3"><EntitlementNotice message={error.message} entitlement /></div>
                ) : (
                    <p className={cn(typeStyles.small, 'mt-3 text-warning')} role="alert">{error.message}</p>
                )
            ) : null}
        </section>
    );
}

function AttachmentNote({ attachment }: { attachment: ApplyEmailState['attachment'] }) {
    return (
        <div className="mt-4 rounded-lg bg-secondary/40 p-3">
            <p className={cn(typeStyles.small, 'text-foreground')}>{ATTACH_NOTE}</p>
            <div className="mt-2">
                {attachment?.pdfUrl ? (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <a href={attachment.pdfUrl}>
                            <Download aria-hidden className="size-3.5" />
                            Download tailored resume PDF
                        </a>
                    </Button>
                ) : attachment ? (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <Link href={attachment.editorUrl}>
                            <FileText aria-hidden className="size-3.5" />
                            Open your tailored resume to export the PDF
                        </Link>
                    </Button>
                ) : (
                    <p className={cn(typeStyles.caption, 'text-muted-foreground')}>No tailored resume for this job yet. Tailor one above, then attach its PDF.</p>
                )}
            </div>
        </div>
    );
}
