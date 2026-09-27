'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
    ArrowRight,
    ShieldCheck,
    Sparkles,
    AlertTriangle,
    CircleAlert,
    Lightbulb,
    Check,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AnonScoreReport, ScoreBand, ScoreFix } from '@/lib/anonScoreSchema';
import { trackFunnelEvent } from '@/lib/funnelEvents';
import { clearPendingScore } from '@/lib/pendingScore';

/**
 * "Fix all" keeps the result SERVER-side (`/api/score/stash`) and carries its
 * id through sign-up as `?stash=`. sessionStorage is only a fast path now: it
 * is per tab, so an email-verification tab lost it, and that was the default
 * path (audit 2026-09-27, B). `/welcome` opens the resume with the fixes.
 */
const SIGNUP_URL = '/sign-up';
const PENDING_SCORE_KEY = 'patronus:pendingScore';

const BAND_META: Record<ScoreBand, { label: string; ring: string; text: string; chip: string }> = {
    needs_work: {
        label: 'Needs work',
        ring: 'text-warning',
        text: 'text-warning',
        chip: 'border-warning/30 bg-warning/10 text-warning',
    },
    good: {
        label: 'Good',
        ring: 'text-primary',
        text: 'text-primary',
        chip: 'border-primary/30 bg-primary/10 text-primary',
    },
    strong: {
        label: 'Strong',
        ring: 'text-success',
        text: 'text-success',
        chip: 'border-success/30 bg-success/10 text-success',
    },
};

const BAND_BLURB: Record<ScoreBand, string> = {
    needs_work: "You're off to a start — a few focused fixes will move this fast.",
    good: "Solid resume. Tighten these and you'll really stand out.",
    strong: "Strong resume. A little polish will push it over the top.",
};

const PRIORITY_META: Record<
    ScoreFix['priority'],
    { label: string; icon: typeof AlertTriangle; chip: string; order: number }
> = {
    high: {
        label: 'High priority',
        icon: AlertTriangle,
        chip: 'border-danger/30 bg-danger/10 text-danger',
        order: 0,
    },
    medium: {
        label: 'Medium priority',
        icon: CircleAlert,
        chip: 'border-warning/30 bg-warning/10 text-warning',
        order: 1,
    },
    low: {
        label: 'Low priority',
        icon: Lightbulb,
        chip: 'border-muted-foreground/30 bg-muted text-muted-foreground',
        order: 2,
    },
};

/** Best-effort sessionStorage write; resilient if unavailable. */
function stashPendingScore(report: AnonScoreReport, extractedText: string) {
    try {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        const payload = {
            extractedText,
            fixes: report.fixes,
            score: report.overall,
            createdAt: new Date().toISOString(),
        };
        window.sessionStorage.setItem(PENDING_SCORE_KEY, JSON.stringify(payload));
    } catch {
        // sessionStorage may be unavailable (private mode / quota). Non-fatal.
    }
}

function ScoreRing({ score, band }: { score: number; band: ScoreBand }) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
    const meta = BAND_META[band];

    return (
        <div className="relative h-36 w-36 shrink-0">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    strokeWidth="10"
                    className="stroke-muted"
                />
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className={cn('transition-all duration-700', meta.ring)}
                    stroke="currentColor"
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn('text-4xl font-semibold', meta.text)}>{score}</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
        </div>
    );
}

function DimensionBar({ score, band }: { score: number; band: ScoreBand }) {
    const color =
        score >= 80 ? 'bg-success' : score >= 60 ? 'bg-primary' : 'bg-warning';
    void band;
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
                className={cn('h-full rounded-full transition-all duration-700', color)}
                style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
        </div>
    );
}

interface ScoreReportProps {
    report: AnonScoreReport;
    extractedText: string;
    onReset: () => void;
}

export function ScoreReport({ report, extractedText, onReset }: ScoreReportProps) {
    const router = useRouter();
    const { isSignedIn } = useAuth();
    const [saving, setSaving] = useState(false);
    const meta = BAND_META[report.band];

    const sortedFixes = [...report.fixes].sort(
        (a, b) => PRIORITY_META[a.priority].order - PRIORITY_META[b.priority].order
    );

    const handleFixAll = async () => {
        if (saving) return;
        trackFunnelEvent('score_cta_clicked', {
            score: report.overall,
            band: report.band,
            fixCount: report.fixes.length,
        });
        setSaving(true);
        // Fast path for this tab, and the fallback if the server copy fails.
        stashPendingScore(report, extractedText);
        let stashId: string | null = null;
        try {
            const res = await fetch('/api/score/stash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ extractedText, fixes: report.fixes, score: report.overall }),
            });
            const data = (await res.json().catch(() => null)) as { success?: boolean; id?: string } | null;
            if (res.ok && data?.success && data.id) stashId = data.id;
        } catch {
            // Offline or blocked: the sessionStorage copy still carries it in this tab.
        }
        // Signed in already: no account to make, open the resume straight away.
        if (isSignedIn) {
            router.push(stashId ? `/welcome?stash=${stashId}` : '/welcome');
            return;
        }
        router.push(stashId ? `${SIGNUP_URL}?stash=${stashId}` : SIGNUP_URL);
    };

    const handleFromScratch = () => {
        // "From scratch" must not reopen the resume they just checked.
        clearPendingScore();
        router.push(isSignedIn ? '/dashboard' : SIGNUP_URL);
    };

    return (
        <div className="space-y-8">
            {/* Headline score */}
            <Card className="overflow-hidden">
                <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:p-8">
                    <ScoreRing score={report.overall} band={report.band} />
                    <div className="flex-1 text-center sm:text-left">
                        <Badge variant="outline" className={cn('mb-3', meta.chip)}>
                            {meta.label}
                        </Badge>
                        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                            Your resume scored {report.overall} / 100
                        </h2>
                        <p className="mt-2 text-muted-foreground">{BAND_BLURB[report.band]}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Dimension breakdown */}
            <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Breakdown
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                    {report.dimensions.map((dim) => (
                        <Card key={dim.key}>
                            <CardContent className="p-4">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        {dim.label}
                                    </span>
                                    <span className="text-sm font-semibold text-foreground">
                                        {dim.score}
                                    </span>
                                </div>
                                <DimensionBar score={dim.score} band={report.band} />
                                <p className="mt-2 text-xs text-muted-foreground">{dim.note}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {/*
                Job match — the same requirement coverage a signed-in user sees
                in the editor's Job Match panel, not a keyword list.

                This section used to be two bags of "matched" and "missing"
                keywords the model produced by eyeballing overlap. That is the
                thinking the 7 Aug audit caught scoring a resume with ten
                fabricated skills at 95/100, and it meant the free checker
                measured something the paid product no longer believes in.
                Someone who signs up after seeing this should meet a better
                version of the same analysis, not a different one.
            */}
            {report.jobMatch && (
                <div>
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Against{' '}
                        {[report.jobMatch.role, report.jobMatch.company].filter(Boolean).join(' at ') ||
                            'this job'}
                    </h3>

                    <Card>
                        <CardContent className="p-4 sm:p-6">
                            {report.jobMatch.score !== null ? (
                                <div className="mb-5 flex items-baseline gap-3">
                                    <span className="text-3xl font-semibold tabular-nums text-foreground">
                                        {report.jobMatch.score}
                                        <span className="text-base text-muted-foreground">/100</span>
                                    </span>
                                    <p className="text-sm text-muted-foreground">
                                        of what this employer asked for is answered by your resume.
                                        Adding keywords cannot move this.
                                    </p>
                                </div>
                            ) : null}

                            {report.jobMatch.unanswered.length > 0 && (
                                <div className="mb-5">
                                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-warning">
                                        <X className="h-4 w-4" aria-hidden /> Not answered
                                    </p>
                                    <ul className="space-y-1.5">
                                        {report.jobMatch.unanswered.map((item) => (
                                            <li key={item.text} className="flex items-start gap-2 text-sm">
                                                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                                                <span className="text-foreground">
                                                    {item.text}
                                                    {item.kind === 'nice' ? (
                                                        <span className="ml-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                                                            bonus
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {report.jobMatch.skillGaps.length > 0 && (
                                <div className="mb-5">
                                    <p className="mb-1.5 text-sm font-medium text-foreground">
                                        Named in the posting, not in your resume
                                    </p>
                                    <p className="mb-2 text-xs text-muted-foreground">
                                        If you have used one, say so — we will never put a skill on
                                        your resume you cannot back up.
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {report.jobMatch.skillGaps.map((skill) => (
                                            <Badge key={skill} variant="outline" className="font-normal">
                                                {skill}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {report.jobMatch.answered.length > 0 && (
                                <div>
                                    <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-success">
                                        <Check className="h-4 w-4" aria-hidden /> Answered
                                    </p>
                                    <ul className="space-y-1.5">
                                        {report.jobMatch.answered.map((item) => (
                                            <li key={item.text} className="flex items-start gap-2 text-sm">
                                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                                                <span className="text-muted-foreground">
                                                    {item.text}
                                                    {item.byDates ? (
                                                        <span className="block text-xs">
                                                            Covered by your dates, not by a bullet.
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Fixes */}
            <div>
                <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Prioritized fixes
                </h3>
                <div className="space-y-4">
                    {sortedFixes.map((fix, idx) => {
                        const pm = PRIORITY_META[fix.priority];
                        const Icon = pm.icon;
                        return (
                            <Card key={idx}>
                                <CardContent className="p-5">
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className={pm.chip}>
                                            <Icon className="mr-1 h-3 w-3" />
                                            {pm.label}
                                        </Badge>
                                        <span className="font-medium text-foreground">
                                            {fix.title}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{fix.problem}</p>
                                    <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                                        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
                                            <Sparkles className="h-3.5 w-3.5" /> Suggested rewrite
                                        </p>
                                        <p className="text-sm text-foreground">{fix.suggestion}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* CTA */}
            <Card className="border-primary/30 bg-primary/5">
                <CardContent className="flex flex-col items-center gap-4 p-6 text-center sm:p-8">
                    <h3 className="text-xl font-semibold tracking-tight text-foreground">
                        Fix all of these in one click
                    </h3>
                    <p className="max-w-md text-sm text-muted-foreground">
                        {isSignedIn
                            ? 'We will open this resume in the editor with these fixes ready to apply.'
                            : 'Create a free account and we will open this resume in the editor with these fixes ready to apply.'}
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Button size="lg" className="group gap-2" onClick={() => void handleFixAll()} disabled={saving}>
                            {saving ? 'Opening your resume…' : 'Fix all of these in one click'}
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                        <Button
                            size="lg"
                            variant="outline"
                            onClick={handleFromScratch}
                        >
                            Build a resume from scratch
                        </Button>
                    </div>
                    <button
                        type="button"
                        onClick={onReset}
                        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                        Score another resume
                    </button>
                </CardContent>
            </Card>

            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/70">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your file is processed in memory. If you choose Fix all, we keep the text for 24 hours
                so it can open after you sign up.
            </p>
        </div>
    );
}
