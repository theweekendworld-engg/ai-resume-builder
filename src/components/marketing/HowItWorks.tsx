import { Check, Pencil, ScanSearch } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * The mechanism, and why it survives contact with a busy week.
 *
 * The steps describe what a NEW user can do today, in the order they do it:
 * check, tailor, log. The earlier version led with "it drafts from your
 * actual work" (GitHub), which no new user could reach while the capture
 * engine was not running (audit 2026-09-27). Automatic drafting returns to
 * step one when it is live; until then it is named as coming soon.
 */

const STEPS = [
    {
        n: '01',
        icon: ScanSearch,
        title: 'Check the resume you have',
        body: 'Upload it and get a score with a prioritised list of fixes, before you create an account. Sign up to keep working on it in the editor.',
        note: 'Free, no card. PDF or DOCX.',
    },
    {
        n: '02',
        icon: Pencil,
        title: 'Tailor it to any job',
        body: 'Paste a job posting and get a version built for it from your own history. If something is missing, it asks you rather than making it up.',
        note: 'Nothing is invented. Figures are copied, never generated.',
    },
    {
        n: '03',
        icon: Check,
        title: 'Log wins as they happen',
        body: 'The incident you ran, the design review you turned around, the number you moved. Type a rough note and it comes back structured — your numbers untouched — and the next resume draws on it.',
        note: 'Drafting wins from GitHub automatically is coming soon.',
    },
];

export function HowItWorks() {
    return (
        <Section id="how-it-works">
            <SectionIntro
                eyebrow="How it works"
                title={
                    <>
                        You bring the facts. <span className="text-primary">We do the writing.</span>
                    </>
                }
                lead={
                    <>
                        The record that makes a good resume has to already exist when you need it.
                        Start with the resume you have, fix it, tailor it — and keep the record
                        going with a sentence whenever something is worth remembering, so by the
                        time the next search or review comes, the evidence is there.
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
