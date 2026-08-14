'use client';

import * as React from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { updateUserPreferences } from '@/actions/profile';
import {
    defaultUserGenerationPreferences,
    type UserGenerationPreferences,
} from '@/lib/userPreferences';

/**
 * Three questions, asked once, that shape every resume afterwards.
 *
 * ── Why here and not in settings ────────────────────────────────────────────
 *
 * The preference machinery already existed and was already honoured by the
 * generator — `targetLength` reaches the length caps, `tonePreference` reaches
 * the writing prompts, `defaultSectionOrder` reaches assembly. What was missing
 * was any moment where a normal user set them. They lived on a dashboard panel
 * most people never open, so in practice every resume was built from defaults
 * nobody chose.
 *
 * Asking at first run costs three clicks once and makes the very first resume
 * theirs. Skip is a real answer — the defaults are sensible, and a signup form
 * that cannot be escaped is worse than a generic first draft.
 *
 * ── Why these three ─────────────────────────────────────────────────────────
 *
 * They are the ones a person has an opinion about before seeing any output.
 * Template, project count and section order are easier to judge by looking at a
 * draft, so they stay in settings where they can be changed with the result on
 * screen rather than guessed at in the abstract.
 */

type Choice<T> = { value: T; label: string; hint?: string };

const LENGTHS: Choice<UserGenerationPreferences['targetLength']>[] = [
    { value: '1-page', label: 'One page — always', hint: 'Strict. Cuts to the strongest lines.' },
    { value: 'auto', label: 'Match it to my experience', hint: 'One page early on, two later.' },
    { value: '2-page', label: 'Two pages is fine', hint: 'Room for more roles and detail.' },
];

const TONES: Choice<UserGenerationPreferences['tonePreference']>[] = [
    { value: 'technical', label: 'Technical', hint: 'Names the systems and the numbers.' },
    { value: 'formal', label: 'Plain and formal', hint: 'Understated, no adjectives.' },
    { value: 'conversational', label: 'Conversational', hint: 'Reads like you talk.' },
];

function Options<T extends string>({
    legend,
    choices,
    value,
    onChange,
}: {
    legend: string;
    choices: Choice<T>[];
    value: T;
    onChange: (next: T) => void;
}) {
    return (
        <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
            {choices.map((choice) => {
                const selected = choice.value === value;
                return (
                    <label
                        key={choice.value}
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                            selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-muted-foreground/40',
                        )}
                    >
                        <input
                            type="radio"
                            name={legend}
                            className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                            checked={selected}
                            onChange={() => onChange(choice.value)}
                        />
                        <span className="min-w-0">
                            <span className="block text-sm text-foreground">{choice.label}</span>
                            {choice.hint ? (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {choice.hint}
                                </span>
                            ) : null}
                        </span>
                    </label>
                );
            })}
        </fieldset>
    );
}

export function ResumeDefaultsStep({ onDone }: { onDone: () => void }) {
    const [targetLength, setTargetLength] = React.useState<
        UserGenerationPreferences['targetLength']
    >(defaultUserGenerationPreferences.targetLength);
    const [tonePreference, setTonePreference] = React.useState<
        UserGenerationPreferences['tonePreference']
    >(defaultUserGenerationPreferences.tonePreference);
    const [leadWithSummary, setLeadWithSummary] = React.useState(true);
    const [busy, setBusy] = React.useState(false);

    const save = async () => {
        setBusy(true);
        // Section order is derived rather than asked about: "lead with a
        // summary" is the only part of it anyone has a view on before seeing a
        // draft, and the rest of the order stays at the default.
        const base = defaultUserGenerationPreferences.defaultSectionOrder;
        const defaultSectionOrder = leadWithSummary
            ? base
            : base.filter((section) => section !== 'summary');

        const result = await updateUserPreferences({
            targetLength,
            tonePreference,
            defaultSectionOrder,
        });
        setBusy(false);

        if (!result.success) {
            // Not a dead end. Defaults still produce a resume, and settings can
            // fix this later — blocking first run over a preference write would
            // be the wrong trade.
            toast.error(result.error ?? 'Could not save those, using defaults for now.');
        }
        onDone();
    };

    return (
        <div className="space-y-6">
            <Options
                legend="How long should your resume be?"
                choices={LENGTHS}
                value={targetLength}
                onChange={setTargetLength}
            />

            <Options
                legend="How should it read?"
                choices={TONES}
                value={tonePreference}
                onChange={setTonePreference}
            />

            <fieldset>
                <legend className="mb-2 text-sm font-medium text-foreground">
                    Lead with a summary?
                </legend>
                <div className="flex gap-2">
                    {[
                        { value: true, label: 'Yes' },
                        { value: false, label: 'No' },
                    ].map((option) => (
                        <Button
                            key={String(option.value)}
                            type="button"
                            variant={leadWithSummary === option.value ? 'default' : 'outline'}
                            size="sm"
                            className="flex-1"
                            onClick={() => setLeadWithSummary(option.value)}
                        >
                            {option.label}
                        </Button>
                    ))}
                </div>
            </fieldset>

            <div className="flex items-center gap-2 pt-1">
                <Button className="flex-1 gap-2" disabled={busy} onClick={() => void save()}>
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Continue
                    <ArrowRight className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" disabled={busy} onClick={onDone}>
                    Skip
                </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
                Every resume follows these. You can change them any time, and a posting never
                overrides them silently.
            </p>
        </div>
    );
}
