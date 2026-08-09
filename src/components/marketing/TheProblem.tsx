import { Section, SectionIntro } from './Section';

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
        <Section className="bg-card/20">
            <SectionIntro
                eyebrow="Why that is hard"
                title="You cannot write down what you cannot remember."
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
            <ol className="spine relative mt-14 max-w-3xl pl-8 sm:pl-10">
                {MOMENTS.map((moment, index) => (
                    <li key={moment.when} className="relative pb-10 last:pb-0">
                        {/* The tick sits ON the rule, centred to the first line. */}
                        <span
                            className="absolute -left-8 top-[7px] flex h-3 w-3 -translate-x-1/2 items-center justify-center sm:-left-10"
                            aria-hidden
                        >
                            <span className="h-[7px] w-[7px] rounded-full bg-border ring-4 ring-background" />
                        </span>

                        <p className="ledger text-[11px] uppercase tracking-[0.16em] text-muted-foreground/50">
                            {String(index + 1).padStart(2, '0')}
                        </p>
                        <h3 className="font-heading mt-1.5 text-lg font-semibold tracking-tight text-foreground">
                            {moment.when}
                        </h3>
                        <p className="mt-2 max-w-xl leading-relaxed text-muted-foreground">
                            {moment.pain}
                        </p>
                    </li>
                ))}
            </ol>

            {/*
              Prose, so not the ledger voice — mono is reserved for dates,
              sources and counts. Set off from the list with a rule so it reads
              as the conclusion of the four rather than a fifth item.
            */}
            <p className="mt-10 max-w-xl border-t border-border/40 pt-6 text-[15px] leading-relaxed text-muted-foreground">
                Four rooms, one missing thing. The resume is simply the room with a deadline —
                which is why it is the one people notice.
            </p>
        </Section>
    );
}
