'use client';

import * as React from 'react';
import { Check, FileText, Link2, NotebookPen, Send, Sparkles, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The product, shown rather than described: one conversation, three turns,
 * on whichever surface the visitor picks.
 *
 * Every turn is something the chat does today (docs/prd/10-chat.md): a note
 * becomes a Win draft that only the user's tap confirms, a job link comes back
 * scored against the record, and "tailor it" builds a resume whose bullet
 * points back at the Win. The figure in the resume is the figure the user
 * typed: that is the numeric guard, demonstrated.
 *
 * The terminal tab is marked "soon" until the CLI is published to npm.
 */

type Surface = 'web' | 'telegram' | 'terminal';

const SURFACES: { key: Surface; label: string; soon?: boolean }[] = [
    { key: 'web', label: 'Web' },
    { key: 'telegram', label: 'Telegram' },
    { key: 'terminal', label: 'Terminal', soon: true },
];

const TURNS = {
    note: 'shipped the retry queue today, p99 went from 900ms to 300ms',
    job: 'linkedin.com/jobs/view/4424231243',
    tailor: 'tailor my resume for it',
};

function UserBubble({ children, surface }: { children: React.ReactNode; surface: Surface }) {
    return (
        <div className="flex justify-end">
            <p
                className={cn(
                    'max-w-[85%] px-3.5 py-2 text-[13.5px] leading-snug',
                    surface === 'telegram'
                        ? 'rounded-2xl rounded-br-md bg-[#2b5278] text-white'
                        : 'rounded-2xl rounded-br-sm bg-primary text-primary-foreground',
                )}
            >
                {children}
            </p>
        </div>
    );
}

function Reply({ text, children }: { text: string; children?: React.ReactNode }) {
    return (
        <div className="flex gap-2.5">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 font-heading text-[10px] font-bold text-primary" aria-hidden>
                P
            </span>
            <div className="min-w-0 flex-1 space-y-2">
                <p className="text-[13.5px] leading-snug text-foreground">{text}</p>
                {children}
            </div>
        </div>
    );
}

function Card({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
    return (
        <div className="flex gap-2.5 rounded-xl border border-border bg-card p-3 text-left">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

function WebThread({ surface }: { surface: Surface }) {
    return (
        <div className="space-y-4">
            <UserBubble surface={surface}>{TURNS.note}</UserBubble>
            <Reply text="Here is the draft. It goes into your record when you confirm it.">
                <Card icon={NotebookPen}>
                    <p className="text-[13px] font-medium">Cut retry-queue p99 from 900ms to 300ms</p>
                    <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-[11.5px] font-medium text-success">
                        <Check className="size-3" strokeWidth={2.5} aria-hidden /> Confirmed. On your record.
                    </p>
                </Card>
            </Reply>

            <UserBubble surface={surface}>{TURNS.job}</UserBubble>
            <Reply text="Read it. You match most of what they ask for.">
                <Card icon={Sparkles}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-[13px] font-medium">Senior Backend Engineer · Acme</p>
                        <p className="text-[12px] font-medium text-success">Strong fit</p>
                    </div>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        <Check className="mr-1 inline size-3 text-success" aria-hidden />
                        Your retry-queue work covers &ldquo;reliability at scale&rdquo;
                    </p>
                </Card>
            </Reply>

            <UserBubble surface={surface}>{TURNS.tailor}</UserBubble>
            <Reply text="Done. Every line comes from your record.">
                <Card icon={FileText}>
                    <p className="text-[13px] leading-snug">• Cut retry-queue p99 latency from 900ms to 300ms.</p>
                    <p className="ledger mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-3 text-[10.5px] text-muted-foreground">
                        <Check className="size-3 text-success" strokeWidth={2.5} aria-hidden />
                        you confirmed this
                        <span aria-hidden>·</span>
                        <Link2 className="size-3" aria-hidden />
                        your note, today
                    </p>
                </Card>
            </Reply>
        </div>
    );
}

function TerminalThread() {
    return (
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-foreground/90">
            <span className="text-muted-foreground">$ </span>patronus &quot;{TURNS.note}&quot;{'\n'}
            <span className="text-muted-foreground">  Draft: Cut retry-queue p99 from 900ms to 300ms</span>{'\n'}
            <span className="text-muted-foreground">  Confirm and add it to your record? [Y/n] </span>y{'\n'}
            <span className="text-success">  In your record.</span>{'\n\n'}
            <span className="text-muted-foreground">$ </span>patronus &quot;{TURNS.job}&quot;{'\n'}
            <span className="text-muted-foreground">  Senior Backend Engineer · Acme</span>{'  '}
            <span className="text-success">Strong fit</span>{'\n\n'}
            <span className="text-muted-foreground">$ </span>patronus &quot;{TURNS.tailor}&quot;{'\n'}
            <span className="text-muted-foreground">  📄 Resume for Senior Backend Engineer at Acme: </span>patronus.cv/editor/…
        </pre>
    );
}

export function ChatDemo() {
    const [surface, setSurface] = React.useState<Surface>('web');

    return (
        <div className="overflow-hidden rounded-2xl border border-border bg-background text-left shadow-2xl shadow-primary/10">
            {/* Window bar with the surface switcher. */}
            <div className="flex items-center justify-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:justify-between">
                <div className="hidden items-center gap-1.5 sm:flex" aria-hidden>
                    <span className="size-2.5 rounded-full bg-foreground/15" />
                    <span className="size-2.5 rounded-full bg-foreground/15" />
                    <span className="size-2.5 rounded-full bg-foreground/15" />
                </div>
                <div role="tablist" aria-label="Where you talk to it" className="flex rounded-lg bg-secondary p-0.5">
                    {SURFACES.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={surface === item.key}
                            onClick={() => setSurface(item.key)}
                            className={cn(
                                'flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                                surface === item.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {item.key === 'telegram' ? <Send className="size-3" aria-hidden /> : null}
                            {item.key === 'terminal' ? <Terminal className="size-3" aria-hidden /> : null}
                            {item.label}
                            {item.soon ? <span className="text-[10px] font-normal text-muted-foreground">soon</span> : null}
                        </button>
                    ))}
                </div>
                <span className="hidden w-[42px] sm:block" aria-hidden />
            </div>

            <div
                className={cn(
                    'p-4 sm:p-5',
                    // The tokens are HSL triples read inline by the theme, so a surface re-themes by overriding them.
                    surface === 'telegram' && 'bg-[#0e1621] [--foreground:210_25%_93%] [--card:211_37%_15%] [--border:211_30%_19%] [--muted-foreground:211_15%_61%]',
                    surface === 'terminal' && 'bg-[#0b0d10] [--foreground:0_0%_90%] [--muted-foreground:212_9%_58%]',
                )}
            >
                {surface === 'terminal' ? <TerminalThread /> : <WebThread surface={surface} />}
            </div>

            {/* The composer, so it reads as a place you type, not a screenshot. */}
            {surface === 'terminal' ? null : (
                <div className={cn('border-t px-4 py-3', surface === 'telegram' ? 'border-[#22303f] bg-[#17212b]' : 'border-border bg-card')}>
                    <p className={cn('rounded-xl px-3 py-2 text-[13px]', surface === 'telegram' ? 'bg-[#242f3d] text-[#8a9aab]' : 'border border-border bg-background text-muted-foreground')}>
                        {surface === 'telegram' ? 'Message' : 'Paste a job link, log a win, or ask anything'}
                    </p>
                </div>
            )}
        </div>
    );
}
