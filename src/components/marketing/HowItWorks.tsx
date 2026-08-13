import { Check, GitBranch, Pencil } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

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
                title={
                    <>
                        You confirm. <span className="text-primary">We do the writing.</span>
                    </>
                }
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

            {/*
              The step number is now the loudest thing in each card, set huge
              and knocked back to a low-opacity accent so it reads as a
              watermark rather than as content. That is what makes three cards
              scan as a SEQUENCE at a glance instead of as three features — the
              eye picks up 01/02/03 before it reads a single word, which is the
              one thing this section has to communicate.
            */}
            <ol className="mt-16 grid gap-6 lg:grid-cols-3">
                {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    return (
                        <Reveal
                            as="li"
                            key={step.n}
                            delay={index * 120}
                            className="mk-card mk-card-hover mk-rail group relative overflow-hidden p-7 pl-8"
                        >
                            <span
                                className="mk-display pointer-events-none absolute -right-2 -top-4 text-[5rem] text-primary/10 transition-colors group-hover:text-primary/20"
                                aria-hidden
                            >
                                {step.n}
                            </span>

                            <span className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                            </span>

                            <h3 className="font-heading relative mt-5 text-lg font-bold leading-snug tracking-tight">
                                {step.title}
                            </h3>
                            <p className="relative mt-2.5 text-sm leading-relaxed text-muted-foreground">
                                {step.body}
                            </p>
                            <p className="ledger relative mt-5 border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground/60">
                                {step.note}
                            </p>
                        </Reveal>
                    );
                })}
            </ol>
        </Section>
    );
}
