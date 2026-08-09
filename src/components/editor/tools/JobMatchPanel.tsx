'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CornerDownLeft, Loader2, Minus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useResumeStore } from '@/store/resumeStore';
import { getResumeCoverage } from '@/actions/coverage';
import { openItems, verdict, type DroppedLine, type ResumeCoverage } from '@/lib/resume/report';
import { GapCaptureRow } from './GapCaptureRow';

/**
 * Job match — what this resume answers, and what it does not.
 *
 * Generation has always known this: which of the posting's requirements the
 * document covers, which skills were wanted but left off for lack of evidence,
 * and which of the candidate's own lines did not fit. Until now all of it was
 * computed and discarded. This is the panel that shows it.
 *
 * ── The posture ─────────────────────────────────────────────────────────────
 *
 * It reports; it does not congratulate. A candidate at 60% does not need
 * "Great work!" and one at 95% does not need a tool telling them they are
 * impressive — both need to know whether to send it and what to fix first.
 * So: unanswered requirements lead, quoted in the employer's own words, and
 * the copy stays flat.
 *
 * The one thing it never does is suggest adding a skill the candidate cannot
 * evidence. That was the old product's actual behaviour, and it is the whole
 * reason the gap list exists — a gap is information, not a to-do to fake.
 */

function ScoreDial({ score }: { score: number }) {
    // A ring rather than a bar: this is a proportion of a fixed set, and the
    // number matters more than the shape, so the figure sits inside it.
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;

    return (
        <div className="relative size-[68px] shrink-0">
            <svg viewBox="0 0 68 68" className="size-full -rotate-90" aria-hidden>
                <circle cx="34" cy="34" r={radius} fill="none" strokeWidth="6" className="stroke-border" />
                <circle
                    cx="34"
                    cy="34"
                    r={radius}
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${circumference}`}
                    className={cn(
                        'transition-[stroke-dasharray]',
                        score >= 80 ? 'stroke-success' : score >= 55 ? 'stroke-warning' : 'stroke-destructive',
                    )}
                />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
                <span className="text-lg font-semibold tabular-nums text-foreground">{score}</span>
            </div>
        </div>
    );
}

function RequirementRow({
    item,
    answered,
}: {
    item: { text: string; kind: 'must' | 'nice' | 'responsibility'; byDates: boolean };
    answered: boolean;
}) {
    return (
        <li className="flex items-start gap-2.5 py-1.5">
            <span className="mt-0.5 shrink-0" aria-hidden>
                {answered ? (
                    <Check className="size-4 text-success" />
                ) : (
                    <Minus className="size-4 text-muted-foreground" />
                )}
            </span>
            <div className="min-w-0 flex-1">
                <p className={cn('text-sm', answered ? 'text-muted-foreground' : 'text-foreground')}>
                    {item.text}
                    <span className="sr-only">{answered ? ' — answered' : ' — not answered'}</span>
                </p>
                {answered && item.byDates ? (
                    // "Answered" with nothing on the page to point at reads
                    // like a bug unless we say where it came from.
                    <p className="text-xs text-muted-foreground">Covered by your dates, not by a bullet.</p>
                ) : null}
            </div>
            {item.kind === 'nice' ? (
                <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide">
                    bonus
                </Badge>
            ) : null}
        </li>
    );
}

function DroppedRow({ line, onRestore }: { line: DroppedLine; onRestore: (line: DroppedLine) => void }) {
    return (
        <li className="rounded-md border border-border bg-card p-3">
            <p className="text-sm text-foreground">{line.text}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                    {line.targetLabel}
                    {' · '}
                    {line.reason === 'cap'
                        ? 'no room on the page'
                        : 'reads as a duty rather than an achievement'}
                </p>
                {line.targetKind === 'experience' && line.targetId ? (
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5 text-xs"
                        onClick={() => onRestore(line)}
                    >
                        <CornerDownLeft className="size-3" aria-hidden />
                        Put it back
                    </Button>
                ) : null}
            </div>
        </li>
    );
}

export function JobMatchPanel({ resumeId }: { resumeId: string }) {
    const [report, setReport] = useState<ResumeCoverage | null>(null);
    const [loading, setLoading] = useState(true);
    const { resumeData, updateExperience } = useResumeStore();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await getResumeCoverage(resumeId);
            setReport(result.success ? result.data : null);
        } finally {
            setLoading(false);
        }
    }, [resumeId]);

    useEffect(() => {
        void load();
    }, [load]);

    const restore = (line: DroppedLine) => {
        const target = resumeData.experience.find((item) => item.id === line.targetId);
        if (!target) {
            toast.error('That role is no longer on this resume.');
            return;
        }
        if (target.description.includes(line.text)) {
            toast.info('That line is already there.');
            return;
        }
        updateExperience(target.id, {
            description: [target.description, line.text].filter(Boolean).join('\n'),
        });
        // Removed from the list rather than left sitting there looking undone.
        setReport((current) =>
            current
                ? { ...current, dropped: current.dropped.filter((entry) => entry.text !== line.text) }
                : current,
        );
        toast.success('Added back. The page may now run long — check the preview.');
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading the match…
            </div>
        );
    }

    // No report is a normal state: a resume written by hand, imported, reused
    // from an earlier generation, or made before this existed. Saying nothing
    // beats an empty shell implying something failed.
    if (!report) {
        return (
            <div className="p-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">No job match yet</CardTitle>
                        <CardDescription>
                            Generate this resume against a job description and we will show which of
                            the employer&apos;s stated requirements it answers — and which it does not.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    const missing = openItems(report);
    const target = [report.role, report.company].filter(Boolean).join(' at ');

    return (
        <div className="space-y-4 p-4">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-start gap-4">
                        {report.score !== null ? <ScoreDial score={report.score} /> : null}
                        <div className="min-w-0 flex-1">
                            <CardTitle className="text-base">{verdict(report)}</CardTitle>
                            <CardDescription>
                                {target
                                    ? `Measured against ${target}.`
                                    : 'Measured against the posting you generated from.'}{' '}
                                {report.score !== null
                                    ? 'The score is the share of stated requirements your evidence answers — adding keywords cannot move it.'
                                    : ''}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {missing.length > 0 ? (
                <Card className="border-warning/40">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="size-4 text-warning" aria-hidden />
                            Not answered
                        </CardTitle>
                        <CardDescription>
                            In the employer&apos;s own words. If you have done one of these, say
                            so — it goes to your Work Log and the next resume can use it.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {/*
                          These rows are the one place the resume writes BACK
                          into the log. Every other surface only reads from it,
                          so an unanswered requirement — shown to someone who
                          very often has done the thing — was the most useful
                          insight in the product being generated and discarded.
                        */}
                        <ul className="divide-y divide-border/60">
                            {missing.map((item) => (
                                <GapCaptureRow key={item.text} item={item} resumeId={resumeId} />
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ) : null}

            {report.skillGaps.length > 0 ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Asked for, and left off</CardTitle>
                        <CardDescription>
                            The posting names these. Nothing in your history mentions them, so they
                            are not on your resume. If you have used one, add it to the relevant role
                            and regenerate — we will not put a skill on the page you cannot back up.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="flex flex-wrap gap-1.5">
                            {report.skillGaps.map((skill) => (
                                <Badge key={skill} variant="outline" className="text-xs font-normal">
                                    {skill}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {report.dropped.length > 0 ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Lines we left out</CardTitle>
                        <CardDescription>
                            Yours, and still true — they just lost the space to something that
                            answered this posting more directly.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <ul className="space-y-2">
                            {report.dropped.map((line) => (
                                <DroppedRow key={line.text} line={line} onRestore={restore} />
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ) : null}

            {report.answered.length > 0 ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Answered</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <ul className="divide-y divide-border/60">
                            {report.answered.map((item) => (
                                <RequirementRow key={item.text} item={item} answered />
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}
