import { Check, GitBranch, Pencil } from 'lucide-react';
import { Section, SectionIntro } from './Section';

/**
 * The mechanism, and why it survives contact with a busy week.
 *
 * The whole design bet (strategy v3 §2) is that capture must be *confirming*,
 * never *writing*. Anything that asks a person to compose prose about
 * themselves on a Tuesday is a habit that dies in three weeks. So the steps
 * are ordered by how little they ask: the machine drafts, you tap ✓, and
 * writing is the fallback rather than the mechanism.
 *
 * Numbered because this genuinely is a sequence — the draft has to exist
 * before there is anything to confirm.
 */

const STEPS = [
    {
        n: '01',
        icon: GitBranch,
        title: 'It drafts from your actual work',
        body: 'Connect GitHub and merged pull requests become candidate wins — title, metric, and a link to the PR, already filled in.',
        note: 'GitHub today. More sources as they earn their place.',
    },
    {
        n: '02',
        icon: Check,
        title: 'You confirm in seconds',
        body: 'A short weekly review: keep, edit, or dismiss. Confirming is one tap, and it is the only step the habit depends on.',
        note: 'The whole ritual is built to take about 90 seconds.',
    },
    {
        n: '03',
        icon: Pencil,
        title: 'You add what code cannot see',
        body: 'The mentoring, the design review you turned around, the incident you ran. Type a rough note and it comes back structured — your numbers untouched.',
        note: 'Nothing is invented. Figures are copied, never generated.',
    },
];

export function HowItWorks() {
    return (
        <Section id="how-it-works">
            <SectionIntro
                eyebrow="How it works"
                title="You confirm. We do the writing."
                lead={
                    <>
                        The record that makes a good resume has to already exist when you need
                        it. Every tool that asks you to sit down and compose one fails for the same
                        reason. This one drafts from what you already did and leaves you the part
                        that takes a moment — so by the time you need a resume, the evidence is
                        there.
                    </>
                }
            />

            <ol className="mt-12 grid gap-6 lg:grid-cols-3">
                {STEPS.map((step) => {
                    const Icon = step.icon;
                    return (
                        <li
                            key={step.n}
                            className="relative rounded-xl border border-border/50 bg-card/30 p-6"
                        >
                            <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                                </span>
                                <span className="font-heading text-xs tabular-nums text-muted-foreground/60">
                                    {step.n}
                                </span>
                            </div>

                            <h3 className="font-heading mt-4 text-base font-semibold leading-snug">
                                {step.title}
                            </h3>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {step.body}
                            </p>
                            <p className="mt-3 border-t border-border/40 pt-3 text-xs text-muted-foreground/70">
                                {step.note}
                            </p>
                        </li>
                    );
                })}
            </ol>
        </Section>
    );
}
