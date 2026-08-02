'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Copy, Download, FileText, Lock, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GroundChip, typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';
import {
    editPacketBlock,
    exportPacket,
    regeneratePacket,
    revertPacketBlock,
} from '@/actions/packets';

import { PACKET_TYPE_LABEL, VERDICT_LABEL, verdictTone, type PacketBlock, type PacketView, type PacketWin } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function winDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface PacketEditorProps {
    packet: PacketView;
}

/**
 * §F3 — the packet editor.
 *
 * A document, not a dashboard: one column at 68ch, `body-read`, no cards around
 * the prose. Two things are load-bearing and easy to lose in a refactor:
 *
 *  - **Every sentence is hoverable back to its Wins.** Nothing in a packet
 *    exists without a Win behind it, and the UI has to be able to prove it.
 *  - **Ungrounded sentences are visible**, with a dotted amber underline and a
 *    `GroundChip`. A packet may ship with warnings; it may never ship with a
 *    silent fabrication.
 */
export function PacketEditor({ packet }: PacketEditorProps) {
    const router = useRouter();
    const content = packet.content;
    const winsById = React.useMemo(
        () => new Map(packet.wins.map((win) => [win.id, win])),
        [packet.wins],
    );
    const [busy, setBusy] = React.useState(false);

    if (!content) return null;

    const warningCount = content.warnings.length;

    /**
     * §3.3 — the confidential question, asked the same way whatever the format.
     * PDF used to be the odd one out simply because it did not exist; letting
     * it skip the prompt would have made the safest-looking export the one
     * that leaks.
     */
    const askIncludeConfidential = () =>
        content.confidentialWinIds.length === 0
            ? true
            : window.confirm(
                `${content.confidentialWinIds.length} win${content.confidentialWinIds.length === 1 ? ' is' : 's are'} marked confidential. Include them? Your manager can see these; a recruiter shouldn't.`,
            );

    const onPrint = () => {
        const includeConfidential = askIncludeConfidential();
        // A new tab, not this one. The print dialog blocks the page it opens
        // over, and the user is mid-edit here — sending them away and back
        // would discard scroll position and any open block editor.
        window.open(
            `/packets/${packet.id}/print?confidential=${includeConfidential ? '1' : '0'}`,
            '_blank',
            'noopener,noreferrer',
        );
    };

    const onExport = async (format: 'markdown' | 'text', mode: 'copy' | 'download') => {
        const includeConfidential = askIncludeConfidential();

        const result = await exportPacket(packet.id, format, { includeConfidential });
        if (!result.success) {
            toast.error(result.error);
            return;
        }

        if (mode === 'copy') {
            await navigator.clipboard.writeText(result.data.body);
            toast.success('Copied — paste it straight into your review tool');
            return;
        }

        const blob = new Blob([result.data.body], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.data.filename;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const onRegenerate = async (keepEdits: boolean) => {
        setBusy(true);
        const result = await regeneratePacket(packet.id, { keepEdits });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        router.refresh();
    };

    return (
        <div className="mx-auto w-full max-w-[1040px] px-4 py-8">
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                    <h1 className={cn(typeStyles.h1, 'text-foreground')}>
                        {PACKET_TYPE_LABEL[packet.type]}
                    </h1>
                    <p className={cn(typeStyles.small, 'text-muted-foreground')}>
                        {[content.header.periodLabel, content.header.employerName, content.header.frameworkName]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" disabled={busy}>
                                Export <ChevronDown className="ml-1 size-3.5" aria-hidden />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void onExport('markdown', 'copy')}>
                                <Copy className="mr-2 size-3.5" aria-hidden /> Copy as Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onExport('markdown', 'download')}>
                                <Download className="mr-2 size-3.5" aria-hidden /> Download .md
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onExport('text', 'copy')}>
                                <Copy className="mr-2 size-3.5" aria-hidden /> Copy as plain text
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={onPrint}>
                                <FileText className="mr-2 size-3.5" aria-hidden /> Save as PDF
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={busy} aria-label="Packet actions">
                                <RotateCcw className="size-3.5" aria-hidden />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => void onRegenerate(true)}>
                                Regenerate, keep my edits
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onRegenerate(false)}>
                                Regenerate from scratch
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>

            <div className="flex gap-8">
                <aside className="hidden w-[240px] shrink-0 lg:block">
                    <nav className="sticky top-6 space-y-1">
                        <RailLink href="#summary" label="Summary" />
                        <RailLink href="#highlights" label="Highlights" />
                        {content.themes.map((theme, index) => (
                            <RailLink
                                key={theme.key}
                                href={`#theme-${index}`}
                                label={theme.title}
                                nested
                            />
                        ))}
                        {content.competencies.length > 0 ? (
                            <RailLink href="#competency" label="By competency" />
                        ) : null}
                        {content.growth.text ? <RailLink href="#growth" label="Growth" /> : null}
                        <RailLink href="#appendix" label="Appendix" />

                        <div className="mt-4 space-y-1 border-t border-border pt-3">
                            <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                                {packet.wins.length} win{packet.wins.length === 1 ? '' : 's'}
                            </p>
                            <p className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                                {content.wordCount} words
                            </p>
                            {warningCount > 0 ? (
                                <a
                                    href={`#block-${content.warnings[0].blockKey}`}
                                    className={cn(typeStyles.caption, 'num block text-warning underline-offset-2 hover:underline')}
                                >
                                    {warningCount} warning{warningCount === 1 ? '' : 's'}
                                </a>
                            ) : (
                                <p className={cn(typeStyles.caption, 'text-success')}>every claim traced</p>
                            )}
                        </div>
                    </nav>
                </aside>

                <article className="min-w-0 max-w-[68ch] flex-1">
                    {content.coherenceNote ? (
                        <p
                            className={cn(
                                typeStyles.small,
                                'mb-6 rounded-lg border border-warning/20 bg-warning/10 p-3 text-foreground',
                            )}
                        >
                            {content.coherenceNote}
                        </p>
                    ) : null}

                    {content.summary.text ? (
                        <section id="summary" className="mb-8">
                            <SectionHeading>Summary</SectionHeading>
                            <EditableBlock packetId={packet.id} block={content.summary} winsById={winsById} />
                        </section>
                    ) : null}

                    {content.themes.length > 0 ? (
                        <section id="highlights" className="mb-8">
                            <SectionHeading>Highlights</SectionHeading>
                            {content.themes.map((theme, index) => (
                                <div key={theme.key} id={`theme-${index}`} className="mb-6">
                                    <h3 className={cn(typeStyles.h3, 'mb-1 text-foreground')}>{theme.title}</h3>
                                    {theme.outcome.text ? (
                                        <EditableBlock
                                            packetId={packet.id}
                                            block={theme.outcome}
                                            winsById={winsById}
                                        />
                                    ) : null}
                                    <ul className="mt-2 space-y-1">
                                        {theme.bullets.map((bullet) => {
                                            const win = winsById.get(bullet.sourceWinIds[0]);
                                            return (
                                                <li key={bullet.key} className="flex items-start gap-1.5">
                                                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                                                    <span className={cn(typeStyles.body, 'text-foreground')}>
                                                        {win?.sensitivity === 'confidential' ? (
                                                            <Lock className="mr-1 inline size-3 text-muted-foreground" aria-label="Confidential" />
                                                        ) : null}
                                                        {bullet.text}
                                                    </span>
                                                    <SourceHover block={bullet} winsById={winsById} />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    {theme.impact?.text ? (
                                        <p className={cn(typeStyles.small, 'mt-2 text-muted-foreground')}>
                                            {/*
                                              * "Scope", not "Impact". The field is specified as
                                              * "who or what was affected" and falls back to
                                              * `theme.scope`, so it holds things like "38 accounts;
                                              * payments team". Under an "Impact:" label that reads
                                              * as a broken impact statement; under "Scope:" it is
                                              * exactly right.
                                              */}
                                            <span className="font-medium text-foreground">Scope: </span>
                                            {theme.impact.text}
                                        </p>
                                    ) : null}
                                </div>
                            ))}
                        </section>
                    ) : null}

                    {content.competencies.length > 0 ? (
                        <section id="competency" className="mb-8">
                            <SectionHeading>By competency</SectionHeading>
                            <ul className="space-y-2">
                                {content.competencies.map((item) => (
                                    <li key={item.key} className="flex items-baseline justify-between gap-4">
                                        <span className={cn(typeStyles.body, 'text-foreground')}>{item.name}</span>
                                        <span
                                            className={cn(
                                                typeStyles.small,
                                                'num shrink-0',
                                                packet.competencyLocked ? 'blur-[5px] select-none' : verdictTone(item.verdict),
                                            )}
                                            aria-hidden={packet.competencyLocked}
                                        >
                                            {VERDICT_LABEL[item.verdict]} · {item.coverage} win
                                            {item.coverage === 1 ? '' : 's'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {packet.competencyLocked ? (
                                <div className="mt-4 rounded-lg border border-border bg-card p-4">
                                    <p className={cn(typeStyles.small, 'text-foreground')}>
                                        You have {packet.wins.length} wins and no gaps analysis. See what is missing
                                        for your next level.
                                    </p>
                                    <Button size="sm" className="mt-3" asChild>
                                        <Link href="/account">See plans</Link>
                                    </Button>
                                </div>
                            ) : null}
                        </section>
                    ) : null}

                    {content.growth.text ? (
                        <section id="growth" className="mb-8">
                            <SectionHeading>Growth &amp; what&apos;s next</SectionHeading>
                            <EditableBlock packetId={packet.id} block={content.growth} winsById={winsById} />
                        </section>
                    ) : null}

                    <section id="appendix" className="mb-8">
                        <details className="rounded-lg border border-border bg-card p-4">
                            <summary className={cn(typeStyles.h3, 'cursor-pointer text-foreground')}>
                                Appendix — {packet.wins.length} win{packet.wins.length === 1 ? '' : 's'}
                            </summary>
                            {content.appendix.note ? (
                                <p className={cn(typeStyles.caption, 'mt-2 text-muted-foreground')}>
                                    {content.appendix.note}
                                </p>
                            ) : null}
                            <ul className="mt-3 space-y-1.5">
                                {packet.wins.map((win) => (
                                    <li key={win.id} className={cn(typeStyles.small, 'text-foreground')}>
                                        {win.sensitivity === 'confidential' ? (
                                            <Lock className="mr-1 inline size-3 text-muted-foreground" aria-label="Confidential" />
                                        ) : null}
                                        {win.title}
                                        <span className="num text-muted-foreground">
                                            {' '}
                                            · {winDate(win.occurredAt)}
                                            {win.metric ? ` · ${win.metric}` : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </details>
                    </section>
                </article>
            </div>
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h2 className={cn(typeStyles.caption, 'mb-2 uppercase tracking-wider text-muted-foreground')}>
            {children}
        </h2>
    );
}

function RailLink({ href, label, nested }: { href: string; label: string; nested?: boolean }) {
    return (
        <a
            href={href}
            className={cn(
                typeStyles.small,
                'block truncate rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground',
                nested && 'pl-5',
            )}
        >
            {label}
        </a>
    );
}

/** The provenance affordance. Its absence would break the product's core promise. */
function SourceHover({
    block,
    winsById,
}: {
    block: PacketBlock;
    winsById: Map<string, PacketWin>;
}) {
    const wins = block.sourceWinIds
        .map((id) => winsById.get(id))
        .filter((win): win is PacketWin => win !== undefined);
    if (wins.length === 0) return null;

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        typeStyles.caption,
                        'num ml-1 shrink-0 rounded px-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100',
                    )}
                    aria-label={`${wins.length} source win${wins.length === 1 ? '' : 's'}`}
                >
                    ◆{wins.length > 1 ? wins.length : ''}
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
                <p className={cn(typeStyles.caption, 'mb-2 text-muted-foreground')}>
                    Backed by {wins.length} win{wins.length === 1 ? '' : 's'}
                </p>
                <ul className="space-y-2">
                    {wins.slice(0, 6).map((win) => (
                        <li key={win.id}>
                            <a
                                href={`/log?win=${win.id}`}
                                className={cn(typeStyles.small, 'block text-foreground underline-offset-2 hover:underline')}
                            >
                                {win.title}
                            </a>
                            <span className={cn(typeStyles.caption, 'num text-muted-foreground')}>
                                {winDate(win.occurredAt)}
                                {win.metric ? ` · ${win.metric}` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}

function EditableBlock({
    packetId,
    block,
    winsById,
}: {
    packetId: string;
    block: PacketBlock;
    winsById: Map<string, PacketWin>;
}) {
    const router = useRouter();
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState(block.text);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => setDraft(block.text), [block.text]);

    const save = async () => {
        setSaving(true);
        const result = await editPacketBlock(packetId, block.key, draft);
        setSaving(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        setEditing(false);
        router.refresh();
    };

    const revert = async () => {
        setSaving(true);
        const result = await revertPacketBlock(packetId, block.key);
        setSaving(false);
        if (!result.success) {
            toast.error(result.error);
            return;
        }
        setEditing(false);
        router.refresh();
    };

    if (editing) {
        return (
            <div>
                <Textarea
                    value={draft}
                    autoFocus
                    rows={Math.max(3, Math.ceil(draft.length / 70))}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            void save();
                        }
                        if (event.key === 'Escape') {
                            setDraft(block.text);
                            setEditing(false);
                        }
                    }}
                />
                <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" onClick={() => void save()} disabled={saving}>
                        <Check className="mr-1 size-3.5" aria-hidden /> Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void revert()} disabled={saving}>
                        Reset to generated
                    </Button>
                    <span className={cn(typeStyles.caption, 'text-muted-foreground')}>⌘↵ to save</span>
                </div>
            </div>
        );
    }

    return (
        <div className="group relative">
            <p
                role="button"
                tabIndex={0}
                onClick={() => setEditing(true)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') setEditing(true);
                }}
                className={cn(
                    typeStyles.bodyRead,
                    'cursor-text rounded text-foreground',
                    block.ground !== 'grounded' &&
                    'underline decoration-warning decoration-dotted underline-offset-4',
                )}
            >
                {block.text}
                <SourceHover block={block} winsById={winsById} />
            </p>
            {block.warning ? (
                <div id={`block-${block.key}`} className="mt-1 flex items-center gap-2">
                    <GroundChip state={block.ground} size="sm" claim={block.text} />
                    <span className={cn(typeStyles.caption, 'text-warning')}>{block.warning}</span>
                </div>
            ) : null}
        </div>
    );
}
