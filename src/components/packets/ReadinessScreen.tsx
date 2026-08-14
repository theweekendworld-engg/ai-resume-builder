'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { typeStyles } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { getReadiness } from '@/actions/packets';

import {
    VERDICT_GLYPH,
    VERDICT_LABEL,
    verdictTone,
    type CompetencyAssessment,
    type FrameworkView,
    type ReadinessReport,
    type UnloggedEvidence,
} from './types';

export interface ReadinessScreenProps {
    report: ReadinessReport;
    frameworks: FrameworkView[];
    /** Free tier: real competency names, values blurred, one CTA. */
    locked: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodLabel(start: Date | string, end: Date | string): string {
    const from = start instanceof Date ? start : new Date(start);
    const to = end instanceof Date ? end : new Date(end);
    return `${MONTHS[from.getUTCMonth()]} – ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
}

/**
 * §G — the readiness report. Standalone, year-round, not buried inside packet
 * generation. This is the artifact people will pay for.
 *
 * Two design constraints that are not negotiable:
 *  - **Tone.** Honest, specific, never flattering, and willing to say the case
 *    is not ready. A tool that always says you are ready is worthless.
 *  - **No score.** Verdicts are plain words. A number out of 100 invites
 *    optimising the number instead of closing the gap.
 */
export function ReadinessScreen({ report: initial, frameworks, locked }: ReadinessScreenProps) {
    const [report, setReport] = React.useState(initial);
    const [pending, setPending] = React.useState(false);

    const framework = frameworks.find((item) => item.id === report.frameworkId) ?? null;
    const levels = framework?.levels ?? [];

    const reload = async (next: { frameworkId?: string | null; targetLevel?: string | null }) => {
        setPending(true);
        const result = await getReadiness({
            frameworkId: next.frameworkId !== undefined ? next.frameworkId : report.frameworkId,
            targetLevel: next.targetLevel !== undefined ? next.targetLevel : report.targetLevelKey,
        });
        setPending(false);
        if (result.success) setReport(result.data);
    };

    return (
        <div className={cn('mx-auto w-full max-w-[640px] px-4 py-10', pending && 'opacity-70')}>
            <header className="mb-8">
                <h1 className={cn(typeStyles.h1, 'uppercase tracking-wide text-foreground')}>
                    {report.targetLevelName
                        ? `Readiness for ${report.targetLevelName}`
                        : 'Level readiness'}
                    {report.frameworkName ? (
                        <span className="text-muted-foreground"> · {report.frameworkName}</span>
                    ) : null}
                </h1>
                <p className={cn(typeStyles.small, 'num mt-1 text-muted-foreground')}>
                    Based on {report.winCount} win{report.winCount === 1 ? '' : 's'},{' '}
                    {periodLabel(report.periodStart, report.periodEnd)}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                    <Select
                        value={report.frameworkId ?? 'default'}
                        onValueChange={(value) =>
                            void reload({ frameworkId: value === 'default' ? null : value, targetLevel: null })
                        }
                    >
                        <SelectTrigger className="w-[220px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">General (Patronus default)</SelectItem>
                            {frameworks.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                    {item.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {levels.length > 0 ? (
                        <Select
                            value={report.targetLevelKey ?? 'none'}
                            onValueChange={(value) =>
                                void reload({ targetLevel: value === 'none' ? null : value })
                            }
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Change target" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No target level</SelectItem>
                                {levels.map((level) => (
                                    <SelectItem key={level.key} value={level.key}>
                                        {level.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : null}
                </div>
            </header>

            <ul className="space-y-2">
                {report.competencies.map((item) => (
                    <CompetencyRow key={item.key} item={item} locked={locked} />
                ))}
            </ul>

            {locked ? (
                <div className="mt-6 rounded-xl border border-border bg-gradient-to-b from-primary/5 to-transparent p-5 patronus-glow-sm">
                    <p className={cn(typeStyles.body, 'text-foreground')}>
                        You have {report.winCount} wins and no gaps analysis. See what is missing for your next
                        level.
                    </p>
                    <Button className="mt-3" asChild>
                        <Link href="/account">See plans</Link>
                    </Button>
                </div>
            ) : (
                <>
                    {report.honestRead.length > 0 ? (
                        <section className="mt-8 border-t border-border pt-6">
                            <h2 className={cn(typeStyles.caption, 'mb-3 uppercase tracking-wider text-muted-foreground')}>
                                The honest read
                            </h2>
                            {report.honestRead.map((paragraph, index) => (
                                <p key={index} className={cn(typeStyles.bodyRead, 'mb-3 text-foreground')}>
                                    {paragraph}
                                </p>
                            ))}
                        </section>
                    ) : null}

                    {report.whatWouldCloseIt.length > 0 ? (
                        <section className="mt-6 border-t border-border pt-6">
                            <h2 className={cn(typeStyles.caption, 'mb-3 uppercase tracking-wider text-muted-foreground')}>
                                What would close it
                            </h2>
                            <ul className="space-y-1.5">
                                {report.whatWouldCloseIt.map((line, index) => (
                                    <li key={index} className="flex items-start gap-2">
                                        <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                                        <span className={cn(typeStyles.body, 'text-foreground')}>{line}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ) : null}

                    {report.unloggedEvidence ? (
                        <UnloggedEvidenceCard evidence={report.unloggedEvidence} />
                    ) : null}
                </>
            )}
        </div>
    );
}

function CompetencyRow({ item, locked }: { item: CompetencyAssessment; locked: boolean }) {
    return (
        <li className="flex items-baseline gap-3">
            {/*
             * The glyph carries the verdict, so it has to be obscured with
             * everything else. Left unblurred it leaked the real assessment
             * through the paywall AND contradicted the teaser beside it — a
             * red ✗ for "absent" sitting next to blurred text reading
             * "strong · 6 wins".
             */}
            <span
                className={cn(
                    'w-4 shrink-0 text-center',
                    locked ? 'select-none blur-[4px] text-muted-foreground' : verdictTone(item.verdict),
                )}
                aria-hidden
            >
                {VERDICT_GLYPH[item.verdict]}
            </span>
            <span className={cn(typeStyles.body, 'min-w-[150px] flex-1 text-foreground')}>{item.name}</span>
            <span className="shrink-0" aria-hidden>
                <Dots filled={item.dots} locked={locked} />
            </span>
            {locked ? (
                <>
                    {/*
                     * Placeholder text, not this user's data. A blur is a
                     * visual treatment only: without `aria-hidden` a screen
                     * reader announces "strong · 6 wins" for every competency
                     * as though it were a real assessment. In a product that
                     * sells never stating an unverified claim, that is the one
                     * thing this screen must not do.
                     */}
                    <span
                        className={cn(typeStyles.small, 'num w-[190px] shrink-0 select-none text-right blur-[5px]')}
                        aria-hidden
                    >
                        strong · 6 wins
                    </span>
                    <span className="sr-only">Locked — upgrade to see this assessment.</span>
                </>
            ) : (
                <span
                    className={cn(
                        typeStyles.small,
                        'num w-[190px] shrink-0 text-right',
                        verdictTone(item.verdict),
                    )}
                >
                    {`${VERDICT_LABEL[item.verdict]} · ${item.rationale}`}
                </span>
            )}
        </li>
    );
}

function Dots({ filled, locked }: { filled: number; locked: boolean }) {
    return (
        <span className={cn('inline-flex gap-0.5', locked && 'blur-[4px]')}>
            {[0, 1, 2, 3, 4].map((index) => (
                <span
                    key={index}
                    className={cn(
                        'size-1.5 rounded-full',
                        index < filled ? 'bg-foreground' : 'bg-border',
                    )}
                />
            ))}
        </span>
    );
}

/**
 * PRD 03 §4.3 — the strongest single interaction on this screen. It converts a
 * diagnosis into capture and closes the loop back to the log, which is why it
 * gets the signature surface and nothing else on the page does.
 */
function UnloggedEvidenceCard({ evidence }: { evidence: UnloggedEvidence }) {
    const [open, setOpen] = React.useState(false);

    return (
        <div className="mt-6 overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent p-5 patronus-glow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={cn(typeStyles.body, 'text-foreground')}>
                    You have {evidence.count} unlogged {evidence.count === 1 ? 'item' : 'items'} that look like{' '}
                    {evidence.competencyName.toLowerCase()}.
                </p>
                <Button size="sm" onClick={() => setOpen((value) => !value)}>
                    {open ? 'Hide' : 'Show me'} <ArrowRight className="ml-1 size-3.5" aria-hidden />
                </Button>
            </div>

            {open ? (
                <ul className="mt-4 space-y-2 border-t border-border pt-3">
                    {evidence.samples.map((sample) => (
                        <li key={sample.id} className="flex items-start justify-between gap-3">
                            <span className={cn(typeStyles.small, 'text-foreground')}>{sample.title}</span>
                            {sample.url ? (
                                <a
                                    href={sample.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(typeStyles.caption, 'shrink-0 text-primary hover:underline')}
                                >
                                    open <ExternalLink className="inline size-3" aria-hidden />
                                </a>
                            ) : null}
                        </li>
                    ))}
                    <li>
                        <Link
                            href="/log"
                            className={cn(typeStyles.caption, 'text-primary underline-offset-2 hover:underline')}
                        >
                            Review them in your log →
                        </Link>
                    </li>
                </ul>
            ) : null}
        </div>
    );
}
