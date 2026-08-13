import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * Name the pain before the mechanism.
 *
 * Strategy v3 §2 is blunt about the real unmet need: "I cannot remember what I
 * actually did." Everyone is told to keep a brag document; almost nobody does,
 * and the ones who try use a doc that rots. A landing page that opens with
 * features asks the reader to work out whether they have this problem. Stating
 * it plainly lets them recognise themselves in two seconds.
 *
 * Deliberately no statistics here. We have no survey to cite, and an invented
 * "83% of engineers…" would undercut the exact thing this product sells.
 */

const MOMENTS = [
    {
        when: 'Review week',
        pain: 'You have two days to reconstruct eight months, so you write what you can remember — which is mostly the last three weeks.',
    },
    {
        when: 'The promotion case',
        // Deliberately does not name a chat tool. Slack is listed in our schema
        // as a future capture source with no adapter, and naming it — even to
        // describe the problem — invites the reader to infer an integration.
        pain: 'Your manager asks for evidence of scope. You know it exists. You cannot find it, and the threads where it happened scrolled away months ago.',
    },
    {
        when: 'A manager change',
        pain: 'The person who saw you do the work has left. Your history now depends on someone else remembering it for you.',
    },
    {
        when: 'The day you leave',
        pain: 'Your performance history lives in your company’s HR system. It does not come with you.',
    },
];

export function TheProblem() {
    return (
        <Section>
            <SectionIntro
                eyebrow="Why that is hard"
                title={
                    <>
                        You cannot write down{' '}
                        <span className="text-primary">what you cannot remember.</span>
                    </>
                }
                lead={
                    <>
                        A resume is only as good as the record behind it, and almost nobody keeps
                        one — not from laziness, but because writing about yourself weekly with no
                        immediate payoff is a habit that does not survive a busy quarter. So the
                        record gets built at the exact moment it is most expensive to build, and
                        the same gap shows up in four different rooms.
                    </>
                }
            />

            {/*
              A spine, not a grid of four boxes.

              These are four moments on one timeline — they happen in this
              order, to the same person, and each is worse than the last
              because the record has decayed further. A 2×2 of equal cards
              says "four unrelated features"; a rule with dated ticks down it
              says "this is a sequence, and it is going somewhere bad."

              It also introduces the ledger motif the rest of the page uses:
              the record has dates, and the dates are the point.
            */}
            <ol className="spine relative mx-auto mt-16 max-w-3xl pl-8 text-left sm:pl-10">
                {MOMENTS.map((moment, index) => (
                    <Reveal
                        as="li"
                        key={moment.when}
                        delay={index * 100}
                        direction="left"
                        className="relative pb-12 last:pb-0"
                    >
                        {/*
                          The tick sits ON the rule, centred to the first line.
                          It carries the accent now rather than the border
                          colour — on a page with one light source, the moments
                          on the timeline are the only thing lit in this
                          section, and an unlit dot on an unlit rule was
                          invisible against the new darker ground.
                        */}
                        <span
                            className="absolute -left-8 top-[9px] flex h-3 w-3 -translate-x-1/2 items-center justify-center sm:-left-10"
                            aria-hidden
                        >
                            <span className="h-[7px] w-[7px] rounded-full bg-primary/70 ring-4 ring-background" />
                        </span>

                        <p className="ledger text-[11px] uppercase tracking-[0.16em] text-primary/60">
                            {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3 className="font-heading mt-2 text-xl font-bold tracking-tight text-foreground">
                            {moment.when}
                        </h3>
                        <p className="mt-2.5 max-w-xl leading-relaxed text-muted-foreground">
                            {moment.pain}
                        </p>
                    </Reveal>
                ))}
            </ol>

            {/*
              Prose, so not the ledger voice — mono is reserved for dates,
              sources and counts. Set off from the list with a rule so it reads
              as the conclusion of the four rather than a fifth item.
            */}
            <Reveal delay={200}>
                <p className="mx-auto mt-12 max-w-2xl border-t border-border/60 pt-8 text-center text-[17px] leading-relaxed text-muted-foreground">
                    Four rooms, one missing thing. The resume is simply the room with a deadline —
                    which is why it is the one people notice.
                </p>
            </Reveal>
        </Section>
    );
}
