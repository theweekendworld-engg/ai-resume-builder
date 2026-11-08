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
        note: 'From the web, or a message to the Telegram bot from your phone.',
    },
];

export function HowItWorks() {
    return (
        <Section id="how-it-works">
            <SectionIntro
                eyebrow="How it works"
                title={
                    <>
                        You bring the facts. <span className="mk-quiet">We do the writing.</span>
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
              Numbered like clauses in a file: the ledger number and the icon
              share the top line, the title is set in the serif, and the
              constraint that makes the step trustworthy sits under a hairline.
              The teal rail on the left edge is what makes three cards read as
              a sequence rather than three features.
            */}
            <ol className="mt-16 grid gap-6 lg:grid-cols-3">
                {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    return (
                        <Reveal
                            as="li"
                            key={step.n}
                            delay={index * 120}
                            className="mk-card mk-card-hover mk-rail relative flex flex-col p-7"
                        >
                            <div className="flex items-center justify-between">
                                <span className="ledger text-[12px] text-muted-foreground">{step.n}</span>
                                <Icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                            </div>

                            <h3 className="mt-6 font-display text-xl font-semibold leading-snug tracking-[-0.01em]">
                                {step.title}
                            </h3>
                            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                                {step.body}
                            </p>
                            <p className="mt-5 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
                                {step.note}
                            </p>
                        </Reveal>
                    );
                })}
            </ol>
        </Section>
    );
}
