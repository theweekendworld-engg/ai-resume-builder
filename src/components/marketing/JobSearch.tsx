import { BellRing, FileText, Inbox, ScanSearch } from 'lucide-react';
import { Section, SectionIntro } from './Section';
import { Reveal } from './Reveal';

/**
 * The job search, end to end (2026-11-07).
 *
 * The page undersold it: job-link analysis sat in one card among the record's
 * payoffs, and the nightly alerts, the apply email and the forwarded-email
 * tracking were not on the page at all (e2e QA, finding 13). This section
 * names the four things in the order a search uses them, in plain words, each
 * with the one constraint that makes it trustworthy.
 *
 * Every claim maps to shipped code:
 *   alerts      `src/lib/watch/` (Greenhouse, Lever, Ashby, SmartRecruiters;
 *               the fail-closed gate in `gate.ts`; Telegram buttons `jw:`)
 *   any post    Scout (`src/lib/scout/`), cited company facts
 *   apply email `src/services/drafts.ts`, `/api/compose/[id]`; revisions are
 *               Telegram follow-ups (`decideInTask`)
 *   tracking    `src/services/journey.ts`, Settings → Email & calendar
 *
 * No LinkedIn crawling is claimed (owner decision, 2026-10-11), and nothing
 * here says the product sends mail: it opens the user's own client.
 */
const STEPS = [
    {
        icon: BellRing,
        title: 'Nightly alerts for companies you name',
        body: 'List the companies you would join. Each night their job boards on Greenhouse, Lever, Ashby and SmartRecruiters are read for new roles and scored against your record. Strong matches arrive on Telegram with buttons to track, draft or skip.',
        proof: 'Only strong matches are sent. Near misses wait on the page with the reason.',
    },
    {
        icon: ScanSearch,
        title: 'Any job post, checked',
        body: 'Send a link or a LinkedIn post from the web chat or Telegram. Back come your fit against each requirement, what the company does and how it is funded, the pay it published, interview write-ups, and the recruiters and hiring managers worth contacting.',
        proof: 'Every company fact links to the page it came from.',
    },
    {
        icon: FileText,
        title: 'A tailored resume and the email to send it',
        body: 'Get a resume built for that job from your own history, and an application email to go with it. The email opens in Gmail or your mail app, ready to send. Reply “make it shorter” on Telegram and a new version comes back.',
        proof: 'Nothing is sent for you. You read it, and you press send.',
    },
    {
        icon: Inbox,
        title: 'Every application, tracked from your inbox',
        body: 'Forward job email to your Patronus address with one Gmail filter. Replies, interview invites and rejections file themselves under the right job, and the job moves forward on its own.',
        proof: 'No Gmail permission needed. Email text is deleted after 180 days.',
    },
] as const;

export function JobSearch() {
    return (
        <Section id="job-search">
            <SectionIntro
                eyebrow="For the job search"
                title={
                    <>
                        From the job post to the sent email.{' '}
                        <span className="text-primary">Then it keeps track.</span>
                    </>
                }
                lead="Name the companies you want and send any job you find. Each one is checked against your record, the resume and the email are written for it, and the replies are filed as they arrive."
            />

            <ol className="mt-16 grid gap-6 md:grid-cols-2">
                {STEPS.map((step, index) => {
                    const Icon = step.icon;
                    return (
                        <Reveal
                            as="li"
                            key={step.title}
                            delay={(index % 2) * 120}
                            className="mk-card mk-card-hover mk-rail group flex flex-col p-7 pl-8"
                        >
                            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                            </span>
                            <h3 className="font-heading mt-5 text-lg font-bold leading-snug tracking-tight">
                                {step.title}
                            </h3>
                            <p className="mt-2.5 flex-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                            <p className="ledger mt-5 border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground">
                                {step.proof}
                            </p>
                        </Reveal>
                    );
                })}
            </ol>
        </Section>
    );
}
