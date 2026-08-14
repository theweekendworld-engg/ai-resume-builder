'use client';

import { useMemo, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { improveSection } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { DiffPreview } from '@/components/editor/DiffPreview';
import { CheckCircle2, ListChecks, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { FixChecklistItem } from '@/store/resumeStore';

const PRIORITY_STYLES: Record<FixChecklistItem['priority'], { label: string; className: string }> = {
    high: { label: 'High', className: 'bg-destructive/15 text-destructive border-destructive/30' },
    medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
    low: { label: 'Low', className: 'bg-secondary text-muted-foreground border-border' },
};

const PRIORITY_ORDER: Record<FixChecklistItem['priority'], number> = { high: 0, medium: 1, low: 2 };

export function FixChecklistPanel() {
    const { resumeData, jobDescription, fixChecklist, toggleFixResolved, updatePersonalInfo } = useResumeStore();

    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [pendingSummary, setPendingSummary] = useState<{ id: string; before: string; after: string } | null>(null);

    const sortedFixes = useMemo(
        () =>
            [...fixChecklist].sort(
                (a, b) =>
                    Number(a.resolved) - Number(b.resolved) ||
                    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
            ),
        [fixChecklist]
    );

    const resolvedCount = fixChecklist.filter((fix) => fix.resolved).length;
    const total = fixChecklist.length;
    const progress = total > 0 ? Math.round((resolvedCount / total) * 100) : 0;

    const handleApplyToSummary = async (fix: FixChecklistItem) => {
        const before = resumeData.personalInfo.summary || '';
        setApplyingId(fix.id);
        try {
            const after = await improveSection(
                'summary',
                before || fix.suggestion,
                jobDescription || undefined,
                `Address this resume reviewer fix: "${fix.title}". Problem: ${fix.problem}. Suggested direction: ${fix.suggestion}`
            );
            setPendingSummary({ id: fix.id, before, after });
        } catch {
            toast.error('Failed to generate an improved summary. Try again.');
        } finally {
            setApplyingId(null);
        }
    };

    const acceptSummary = (fix: FixChecklistItem) => {
        if (!pendingSummary) return;
        updatePersonalInfo({ summary: pendingSummary.after });
        toggleFixResolved(fix.id, true);
        setPendingSummary(null);
        toast.success('Summary updated and fix checked off.');
    };

    if (total === 0) {
        return (
            <Card className="h-full">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ListChecks className="h-5 w-5 text-primary" />
                        Fix Checklist
                    </CardTitle>
                    <CardDescription>
                        Issues from your free resume score appear here so you can resolve each one.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No carried-over fixes. Run a free resume check to populate this list, or use Review &amp; Improve
                        for AI suggestions.
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="flex h-full flex-col">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <ListChecks className="h-5 w-5 text-primary" />
                    Fix Checklist
                </CardTitle>
                <CardDescription>
                    Carried over from your free resume score. Check items off as you address them.
                </CardDescription>
                <div className="mt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            {resolvedCount} of {total} resolved
                        </span>
                        <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {sortedFixes.map((fix) => {
                    const priority = PRIORITY_STYLES[fix.priority];
                    const showingDiff = pendingSummary?.id === fix.id;
                    return (
                        <div
                            key={fix.id}
                            className={cn(
                                'rounded-lg border border-border bg-card/50 p-4 transition-opacity',
                                fix.resolved && 'opacity-60'
                            )}
                        >
                            <div className="flex items-start gap-3">
                                <Checkbox
                                    checked={fix.resolved}
                                    onCheckedChange={(checked) => toggleFixResolved(fix.id, checked === true)}
                                    className="mt-0.5"
                                    aria-label={`Mark "${fix.title}" resolved`}
                                />
                                <div className="min-w-0 flex-1 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className={cn('text-[10px]', priority.className)}>
                                            {priority.label}
                                        </Badge>
                                        <p className={cn('text-sm font-medium', fix.resolved && 'line-through')}>
                                            {fix.title}
                                        </p>
                                        {fix.resolved && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{fix.problem}</p>
                                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
                                        <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                                            <Sparkles className="h-3 w-3" />
                                            Suggested rewrite
                                        </p>
                                        <p className="text-xs text-foreground">{fix.suggestion}</p>
                                    </div>

                                    {showingDiff && pendingSummary && (
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                Proposed summary
                                            </p>
                                            <DiffPreview before={pendingSummary.before} after={pendingSummary.after} />
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={() => acceptSummary(fix)}>
                                                    Accept &amp; resolve
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setPendingSummary(null)}
                                                >
                                                    Dismiss
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {!showingDiff && !fix.resolved && (
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => handleApplyToSummary(fix)}
                                                disabled={applyingId === fix.id}
                                                className="h-7 gap-1.5 text-xs"
                                            >
                                                {applyingId === fix.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <Wand2 className="h-3.5 w-3.5" />
                                                )}
                                                Apply to summary
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => toggleFixResolved(fix.id, true)}
                                                className="h-7 text-xs"
                                            >
                                                Mark resolved
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
