import { Plus } from 'lucide-react';
import { CONTACT_EMAIL } from './Contact';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * The objections, answered before they are asked.
 *
 * ── Why `<details>` and not an accordion component ──────────────────────────
 *
 * `src/components/ui/` has no accordion, and the obvious move is to add the
 * Radix one. It is not needed here. `<details>`/`<summary>` is a disclosure
 * widget with the open/close state, keyboard handling, focus behaviour and
 * `aria-expanded` semantics already implemented by the browser — the exact
 * feature set the Radix primitive reimplements in JavaScript. It also renders
 * open-able content with JS disabled, and it costs nothing to ship.
 *
 * The one thing it does not give us is an animated height, which is why the
 * marker rotates instead. Height transitions on `<details>` require measuring
 * the content, and a section of the page that only ever expands by a paragraph
 * does not need to buy that.
 *
 * ── The answers ─────────────────────────────────────────────────────────────
 *
 * Every one of these is a real constraint of the system as built, written the
 * way it would be said to someone's face. The temptation in an FAQ is to use it
 * as a second features list — questions phrased as "How does the powerful X
 * work?" — which readers correctly discount. The questions here are the ones a
 * sceptic actually has, including the two that are least flattering to us: how
 * little we integrate with today, and the fact that there is no price on the
 * page.
 */

const QUESTIONS = [
    {
        q: 'Do I have to write something every week?',
        a: 'No. Log a win when something happens — one rough sentence is enough, and it comes back structured with your numbers untouched. Automatic drafting from merged pull requests is coming soon; when it is live, your job becomes keep, edit or dismiss.',
    },
    {
        q: 'What can it draft from today?',
        a: 'Your own notes. That is the honest answer: type what happened and it comes back structured. GitHub is the first automatic source and is coming soon — one source working properly, rather than a list of logos where most of the connectors are aspirational.',
    },
    {
        q: 'Can it invent a number to make me look better?',
        a: 'It cannot. A generated document is checked against the log it was built from, and any figure that is not present in the source is stripped before the document reaches you. A claim that cannot be positively grounded resolves to “needs confirmation” — never to “grounded”. Errors and timeouts resolve downward, not upward.',
    },
    {
        q: 'Some of my work is confidential. What happens to it?',
        a: 'Wins you mark confidential are excluded from anything that leaves the product — resumes, packets, application answers. The filter runs in the database query that fetches the evidence, so confidential work is never in the material a model sees. We do not ask a model politely to skip it.',
    },
    {
        q: 'Is my work sold, or used to train models?',
        a: 'Neither. Not sold, not used as training data. The record is the asset you are building, and the entire premise falls apart if it is also quietly someone else’s.',
    },
    {
        q: 'What if I am not looking for a job?',
        a: 'Then you are the person this is actually for. The resume is the moment with a deadline, which is why it leads the page — but the record is what pays off at review time, at a promotion case, and on the day your manager changes and the person who saw you do the work is gone.',
    },
    {
        q: 'What happens to my history if I stop paying?',
        a: 'It is hidden, never deleted. Downgrading turns off the paid surfaces; your wins, evidence and confirmations stay exactly where they are, and come back untouched if you return.',
    },
    {
        q: 'What does it cost?',
        a: `Keeping the log is free and always will be, and the free plan works today. The paid plans and their prices are listed under Pricing above; they open soon. If you are unsure which you need, write to ${CONTACT_EMAIL}.`,
    },
];

export function Faq() {
    return (
        <Section id="faq">
            <SectionIntro
                eyebrow="Questions"
                title={
                    <>
                        The things you’d ask{' '}
                        <span className="text-primary">before trusting this.</span>
                    </>
                }
            />

            <div className="mx-auto mt-14 max-w-3xl divide-y divide-border/60 border-y border-border/60">
                {QUESTIONS.map((item, index) => (
                    <Reveal key={item.q} delay={Math.min(index, 4) * 70}>
                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-left transition-colors hover:text-primary [&::-webkit-details-marker]:hidden">
                                <span className="font-heading text-[17px] font-bold leading-snug tracking-tight">
                                    {item.q}
                                </span>
                                <span
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-all duration-300 group-open:rotate-45 group-open:border-primary/40 group-open:bg-primary/10 group-open:text-primary"
                                    aria-hidden
                                >
                                    <Plus className="h-4 w-4" strokeWidth={2} />
                                </span>
                            </summary>
                            <p className="max-w-2xl pb-7 pr-14 text-[15px] leading-relaxed text-muted-foreground">
                                {item.a}
                            </p>
                        </details>
                    </Reveal>
                ))}
            </div>

            <Reveal delay={140}>
                <p className="mt-10 text-center text-sm text-muted-foreground">
                    Something not answered here?{' '}
                    <a
                        href={`mailto:${CONTACT_EMAIL}`}
                        className="font-semibold text-primary underline-offset-4 hover:underline"
                    >
                        {CONTACT_EMAIL}
                    </a>
                </p>
            </Reveal>
        </Section>
    );
}
