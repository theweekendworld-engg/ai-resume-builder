'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Loader2, Lock } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { updateUserPreferences } from '@/actions/profile';
import type { UserGenerationPreferences } from '@/lib/userPreferences';

type Section = UserGenerationPreferences['defaultSectionOrder'][number];

/**
 * Which sections a resume has, and in what order.
 *
 * ── Why this is a real screen and not a checkbox ────────────────────────────
 *
 * `defaultSectionOrder` has driven generation for a long time and nothing ever
 * let a user set it. Worse, the agentic path hardcoded the list, so a
 * preference stored during onboarding was silently overridden on every
 * generation. The mechanism worked; nobody could reach it.
 *
 * ── Why experience cannot be turned off ─────────────────────────────────────
 *
 * A resume without work history is not a shorter resume, it is a different
 * document. The schema also floors the list at one entry, so something has to
 * be unremovable — better that it is the section whose absence would be a bug
 * report than whichever one a user happened to switch off last.
 *
 * ── Why the order is buttons and not drag ───────────────────────────────────
 *
 * Five items, moved rarely, and a drag implementation that works with a
 * keyboard and a screen reader is most of a component library. Up and down are
 * unambiguous, reorderable one-handed, and already accessible.
 */

const ALL: readonly Section[] = ['summary', 'experience', 'projects', 'education', 'skills'];

const LABEL: Record<Section, string> = {
    summary: 'Summary',
    experience: 'Work experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
};

const HINT: Record<Section, string> = {
    summary: 'Two or three lines positioning you for the role.',
    experience: 'Your roles and what you did in them.',
    projects: 'Selected work, chosen for each posting.',
    education: 'Degrees and institutions.',
    skills: 'Grouped, and only ones your record can evidence.',
};

/** Removing this would leave a document nobody would call a resume. */
const REQUIRED: Section = 'experience';

export function ResumeSectionsPanel({ initial }: { initial: Section[] }) {
    const [order, setOrder] = React.useState<Section[]>(
        initial.length ? initial : [...ALL],
    );
    const [busy, setBusy] = React.useState(false);
    const [dirty, setDirty] = React.useState(false);

    const enabled = new Set(order);
    // Off sections keep a stable position underneath the on ones, so toggling
    // something back does not drop it at the bottom of a list it used to lead.
    const hidden = ALL.filter((section) => !enabled.has(section));

    const toggle = (section: Section) => {
        if (section === REQUIRED) return;
        setDirty(true);
        setOrder((current) =>
            current.includes(section)
                ? current.filter((entry) => entry !== section)
                : // Restored where it sits in the canonical order rather than
                  // appended, which is almost always where someone expects it.
                  ALL.filter((entry) => current.includes(entry) || entry === section),
        );
    };

    const move = (section: Section, direction: -1 | 1) => {
        setDirty(true);
        setOrder((current) => {
            const index = current.indexOf(section);
            const next = index + direction;
            if (index < 0 || next < 0 || next >= current.length) return current;
            const copy = [...current];
            [copy[index], copy[next]] = [copy[next], copy[index]];
            return copy;
        });
    };

    const save = async () => {
        setBusy(true);
        const result = await updateUserPreferences({ defaultSectionOrder: order });
        setBusy(false);
        if (!result.success) {
            toast.error(result.error ?? 'Could not save that.');
            return;
        }
        setDirty(false);
        toast.success('Saved. Every new resume follows this.');
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Sections</CardTitle>
                <CardDescription>
                    What every resume includes, and the order it reads in. You can still change
                    an individual resume in the editor without touching this.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
                <ul className="divide-y divide-border rounded-lg border border-border">
                    {order.map((section, index) => (
                        <li key={section} className="flex items-center gap-3 p-3">
                            <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                                {index + 1}
                            </span>

                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 text-sm text-foreground">
                                    {LABEL[section]}
                                    {section === REQUIRED ? (
                                        <Lock
                                            className="size-3 text-muted-foreground"
                                            aria-label="always included"
                                        />
                                    ) : null}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {HINT[section]}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-0.5">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0"
                                    disabled={index === 0}
                                    onClick={() => move(section, -1)}
                                    aria-label={`Move ${LABEL[section]} up`}
                                >
                                    <ArrowUp className="size-3.5" aria-hidden />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0"
                                    disabled={index === order.length - 1}
                                    onClick={() => move(section, 1)}
                                    aria-label={`Move ${LABEL[section]} down`}
                                >
                                    <ArrowDown className="size-3.5" aria-hidden />
                                </Button>
                            </div>

                            <Switch
                                checked
                                disabled={section === REQUIRED}
                                onCheckedChange={() => toggle(section)}
                                aria-label={`Include ${LABEL[section]}`}
                            />
                        </li>
                    ))}
                </ul>

                {hidden.length > 0 ? (
                    <div>
                        <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                            Not on your resumes
                        </p>
                        <ul className="divide-y divide-border rounded-lg border border-dashed border-border">
                            {hidden.map((section) => (
                                <li
                                    key={section}
                                    className={cn('flex items-center gap-3 p-3 opacity-70')}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-foreground">{LABEL[section]}</p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {HINT[section]}
                                        </p>
                                    </div>
                                    <Switch
                                        checked={false}
                                        onCheckedChange={() => toggle(section)}
                                        aria-label={`Include ${LABEL[section]}`}
                                    />
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                <div className="flex items-center gap-3">
                    <Button className="gap-2" disabled={busy || !dirty} onClick={() => void save()}>
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                        Save
                    </Button>
                    {dirty ? (
                        <span className="text-xs text-muted-foreground">Unsaved changes</span>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
}
