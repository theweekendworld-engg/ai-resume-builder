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
        <section className="border-b border-border/40 bg-card/20">
            <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
                <div className="max-w-2xl">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary/80">
                        The problem
                    </p>
                    <h2 className="font-heading mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                        Nobody keeps the brag doc.
                    </h2>
                    <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                        Not because people are lazy — because writing about yourself, weekly, with
                        no immediate payoff, is a habit almost nobody sustains. So the record only
                        gets built at the exact moment it is most expensive to build.
                    </p>
                </div>

                <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border/50 bg-border/40 sm:grid-cols-2">
                    {MOMENTS.map((moment) => (
                        <div key={moment.when} className="bg-background/60 p-6">
                            <p className="font-heading text-sm font-semibold text-foreground">
                                {moment.when}
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                {moment.pain}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
