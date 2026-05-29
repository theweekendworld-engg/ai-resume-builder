'use client';

import { useMemo, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { improveSection } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DiffPreview } from '@/components/editor/DiffPreview';
import { estimateResumeLength } from '@/lib/resumeLength';
import { Loader2, Wand2, Scissors, KeyRound, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';

type QuickActionId = 'tighten-summary' | 'add-keywords' | 'fit-one-page';

interface PendingAction {
    id: QuickActionId;
    label: string;
    before: string;
    after: string;
    apply: () => void;
}

/**
 * Context-aware one-click copilot actions. Each reads the current resume + JD
 * from the store, calls an EXISTING action (`improveSection`), and shows a diff
 * before applying — so the conversational copilot can "tighten my summary",
 * "add missing keywords", or "make it fit one page" with a trustworthy preview.
 */
export function CopilotQuickActions() {
    const {
        resumeData,
        jobDescription,
        atsScore,
        updatePersonalInfo,
        updateSkills,
        updateExperience,
    } = useResumeStore();

    const [loadingId, setLoadingId] = useState<QuickActionId | null>(null);
    const [pending, setPending] = useState<PendingAction | null>(null);

    const length = useMemo(() => estimateResumeLength(resumeData), [resumeData]);
    const missingKeywords = atsScore?.missingKeywords ?? [];

    const runTightenSummary = async () => {
        const before = resumeData.personalInfo.summary || '';
        if (!before.trim()) {
            toast.error('Add a summary first.');
            return;
        }
        setLoadingId('tighten-summary');
        try {
            const after = await improveSection('summary', before, jobDescription || undefined, 'Tighten to the strongest 2 sentences; remove filler.');
            setPending({
                id: 'tighten-summary',
                label: 'Tightened summary',
                before,
                after,
                apply: () => updatePersonalInfo({ summary: after }),
            });
        } catch {
            toast.error('Failed to tighten summary.');
        } finally {
            setLoadingId(null);
        }
    };

    const runAddKeywords = async () => {
        if (missingKeywords.length === 0) {
            toast.error('No missing keywords detected. Run a score in Review & Improve first.');
            return;
        }
        const before = resumeData.skills.join(', ');
        setLoadingId('add-keywords');
        try {
            const after = await improveSection(
                'skills',
                before,
                jobDescription || undefined,
                `Weave in these job-relevant skills if genuinely applicable: ${missingKeywords.join(', ')}. Do not invent unrelated skills.`
            );
            setPending({
                id: 'add-keywords',
                label: 'Updated skills',
                before,
                after,
                apply: () =>
                    updateSkills(
                        after
                            .split(/[,\n;]/g)
                            .map((skill) => skill.trim())
                            .filter(Boolean)
                    ),
            });
        } catch {
            toast.error('Failed to update skills.');
        } finally {
            setLoadingId(null);
        }
    };

    const runFitOnePage = async () => {
        // Tighten the longest experience block — the usual overflow culprit.
        const target = [...resumeData.experience].sort(
            (a, b) => b.description.length - a.description.length
        )[0];
        if (!target || !target.description.trim()) {
            toast.error('No experience bullets to condense.');
            return;
        }
        const before = target.description;
        setLoadingId('fit-one-page');
        try {
            const after = await improveSection(
                'experience',
                before,
                jobDescription || undefined,
                'Condense to the 3 highest-impact bullets, each one line. Prioritize fitting on a single page.'
            );
            setPending({
                id: 'fit-one-page',
                label: `Condensed "${target.role || target.company || 'experience'}"`,
                before,
                after,
                apply: () => updateExperience(target.id, { description: after }),
            });
        } catch {
            toast.error('Failed to condense experience.');
        } finally {
            setLoadingId(null);
        }
    };

    const acceptPending = () => {
        if (!pending) return;
        pending.apply();
        toast.success(`${pending.label} applied.`);
        setPending(null);
    };

    return (
        <div className="space-y-3">
            <Label className="flex items-center gap-2">
                <Wand2 className="h-4 w-4" />
                Quick actions
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start gap-2 py-2 text-xs"
                    onClick={runTightenSummary}
                    disabled={loadingId !== null}
                >
                    {loadingId === 'tighten-summary' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                    Tighten summary
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start gap-2 py-2 text-xs"
                    onClick={runAddKeywords}
                    disabled={loadingId !== null}
                >
                    {loadingId === 'add-keywords' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    Add missing keywords{missingKeywords.length > 0 ? ` (${missingKeywords.length})` : ''}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start gap-2 py-2 text-xs"
                    onClick={runFitOnePage}
                    disabled={loadingId !== null}
                >
                    {loadingId === 'fit-one-page' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Minimize2 className="h-3.5 w-3.5" />}
                    Make it fit one page
                </Button>
            </div>

            <p className="text-xs text-muted-foreground">
                Estimated length: ~{length.estimatedPages} page{length.estimatedPages === 1 ? '' : 's'}
                {length.fitsOnePage ? ' — fits one page.' : ` — about ${length.overflowLines} line(s) over one page.`}
            </p>

            {pending && (
                <div className="space-y-2 rounded-md border border-border bg-card/50 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{pending.label}</p>
                    <DiffPreview before={pending.before} after={pending.after} />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={acceptPending}>
                            Accept
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                            Dismiss
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
