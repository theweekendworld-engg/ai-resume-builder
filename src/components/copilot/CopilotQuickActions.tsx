'use client';

import { useMemo, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { improveSection } from '@/actions/ai';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DiffPreview } from '@/components/editor/DiffPreview';
import { estimateResumeLength } from '@/lib/resumeLength';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface PendingAction {
    label: string;
    before: string;
    after: string;
    apply: () => void;
}

/**
 * Ask for a change to one part of the resume.
 *
 * ── What this replaced, and why all three went ──────────────────────────────
 *
 * Three one-click buttons used to sit here: Tighten summary, Add missing
 * keywords, Make it fit one page.
 *
 * "Add missing keywords" was the serious one. It added skills to a resume
 * BECAUSE a posting asked for them — the exact behaviour the rest of this
 * product is built to prevent. The tools deliberately cannot see the posting,
 * `getSkillsWithEvidence` derives from the record alone, and the numeric guard
 * checks every figure against its source; this button was a hole in all of it,
 * on the same screen. It also errored on most clicks, needing an ATS score run
 * first.
 *
 * "Tighten summary" is one instruction in the box below, and keeping a bespoke
 * handler for a phrase a user can type is a second code path that can rot
 * separately.
 *
 * "Make it fit one page" competed with `targetLength`, which is now a stored
 * preference that generation honours. Two mechanisms for one decision, neither
 * aware of the other.
 *
 * ── What speed looks like instead ───────────────────────────────────────────
 *
 * Chips inside the box. They fill the instruction and run it, so a tap is still
 * one action — but they are text in the same field a user can edit, not three
 * separate handlers pretending to be features.
 *
 * ── Why the length estimate stayed ──────────────────────────────────────────
 *
 * It is information, not an action. "About 22 lines over one page" is a fact
 * about the document that changes what you would ask for next, and nothing else
 * on this screen tells you.
 */

/** Common asks, prefilled. Editable, because they are only text. */
const CHIPS: readonly string[] = [
    'Shorter',
    'More specific',
    'Lead with the impact',
    'Less jargon',
];

export function CopilotQuickActions() {
    const {
        resumeData,
        jobDescription,
        updatePersonalInfo,
        updateSkills,
        updateExperience,
    } = useResumeStore();

    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<PendingAction | null>(null);
    const [target, setTarget] = useState<string>('summary');
    const [ask, setAsk] = useState('');

    const length = useMemo(() => estimateResumeLength(resumeData), [resumeData]);

    /** Where an ask can point, and what it edits. */
    const targets = [
        { id: 'summary', label: 'Summary' },
        { id: 'skills', label: 'Skills' },
        ...resumeData.experience.map((item) => ({
            id: `experience:${item.id}`,
            label: `${item.company || 'Role'} — bullets`,
        })),
    ];

    const runAsk = async (raw: string) => {
        const instruction = raw.trim();
        if (!instruction) return;

        const role = target.startsWith('experience:')
            ? resumeData.experience.find(
                  (item) => item.id === target.slice('experience:'.length),
              )
            : null;

        const before =
            target === 'summary'
                ? resumeData.personalInfo.summary || ''
                : target === 'skills'
                  ? resumeData.skills.join(', ')
                  : role?.description || '';

        if (!before.trim()) {
            toast.error('That section is empty — add something to improve first.');
            return;
        }

        const sectionType =
            target === 'summary' ? 'summary' : target === 'skills' ? 'skills' : 'experience';

        setBusy(true);
        try {
            const after = await improveSection(
                sectionType,
                before,
                jobDescription || undefined,
                instruction,
            );
            setPending({
                label: targets.find((entry) => entry.id === target)?.label ?? 'Change',
                before,
                after,
                apply: () => {
                    if (target === 'summary') updatePersonalInfo({ summary: after });
                    else if (target === 'skills')
                        updateSkills(
                            after.split(',').map((entry) => entry.trim()).filter(Boolean),
                        );
                    else if (role) updateExperience(role.id, { description: after });
                },
            });
            setAsk('');
        } catch {
            toast.error('Could not make that change.');
        } finally {
            setBusy(false);
        }
    };

    const acceptPending = () => {
        pending?.apply();
        setPending(null);
        toast.success('Applied.');
    };

    return (
        <div className="space-y-3">
            <Label className="text-sm font-medium">Ask for a change</Label>

            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    aria-label="What to change"
                >
                    {targets.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                            {entry.label}
                        </option>
                    ))}
                </select>
                <input
                    value={ask}
                    onChange={(event) => setAsk(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void runAsk(ask);
                    }}
                    placeholder="e.g. drop the jargon, lead with the payments work"
                    className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
                    disabled={busy}
                />
                <Button
                    size="sm"
                    className="h-9"
                    disabled={busy || !ask.trim()}
                    onClick={() => void runAsk(ask)}
                >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : 'Improve'}
                </Button>
            </div>

            <div className="flex flex-wrap gap-1">
                {CHIPS.map((chip) => (
                    <Button
                        key={chip}
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        disabled={busy}
                        onClick={() => {
                            setAsk(chip);
                            void runAsk(chip);
                        }}
                    >
                        {chip}
                    </Button>
                ))}
            </div>

            <p className="text-xs text-muted-foreground">
                Only the part you pick is sent and only it changes. Everything else on the resume
                is left exactly as it is.
            </p>

            {/*
              Stated as the overflow, not the page count. "~1.5 pages" invites
              a shrug; "22 lines over one page" is a number you can act on, and
              it is the same fact.
            */}
            <p className="text-xs text-muted-foreground">
                {length.fitsOnePage
                    ? `Fits one page — about ${length.estimatedLines} lines.`
                    : `About ${length.overflowLines} line${length.overflowLines === 1 ? '' : 's'} over one page (${length.pageCount} pages).`}
            </p>

            {pending && (
                <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs font-medium text-muted-foreground">{pending.label}</p>
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
