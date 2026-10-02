import Link from 'next/link';
import { Bell, Clock, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CONTACT_EMAIL } from '@/components/marketing/Contact';

/**
 * The "tell me when it's ready" address. A mailto rather than a form: it works
 * with no new endpoint, lands with a person, and says which feature they were
 * waiting for, so the page is never a dead end (audit 2026-09-27, flow E).
 */
export function waitlistHref(feature: string): string {
    const subject = encodeURIComponent(`Tell me when ${feature} is ready`);
    const body = encodeURIComponent(`I tried to open ${feature} in Patronus. Please let me know when it is switched on for my account.`);
    return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

/**
 * What a signed-in customer sees instead of a 404.
 *
 * ── The distinction that was missing ────────────────────────────────────────
 *
 * Every gated surface called `notFound()` when its flag was off. For a
 * stranger that is right: a 404 does not disclose that an unreleased feature
 * exists. For a customer who read about the feature on the pricing page thirty
 * seconds ago — and whose landing-page CTA was literally "Start your work log"
 * pointing at `/log` — the same response says the product is broken.
 *
 * Those are two audiences and they were getting one answer. Strangers still
 * get `notFound()`; signed-in users get this.
 *
 * ── And the second conflation ───────────────────────────────────────────────
 *
 * `/home` and `/radar` also called `notFound()` when the *data load* failed,
 * which made an infrastructure error indistinguishable from a feature that
 * does not exist. `reason="error"` separates them: one is worth retrying and
 * the other is not, and only one of them is our fault in a way the customer
 * should hear about.
 */

/**
 * One place for the names and one-liners, so `/log` and `/log/backfill` do not
 * describe the same feature two different ways.
 */
export const FEATURE_COPY = {
    work_log: {
        feature: 'The Work Log',
        blurb: 'The running record of what you have actually done — the thing every resume, packet and review here is built from. It is being switched on in stages.',
    },
    github_capture: {
        feature: 'GitHub capture',
        blurb: 'Turns your commits and pull requests into draft entries in your Work Log, so the record keeps itself. It is being switched on in stages.',
    },
    review_packet: {
        feature: 'Review packets',
        blurb: 'Your evidence, arranged for a performance review or a promotion case. It is being switched on in stages.',
    },
    month_in_review: {
        feature: 'Month in Review',
        blurb: 'A monthly read on what you shipped and what it added up to. It is being switched on in stages.',
    },
    backfill: {
        feature: 'Backfill',
        blurb: 'Reconstructs the years before you started keeping a log, one conversation at a time. It is being switched on in stages.',
    },
    career_radar: {
        feature: 'Career Radar',
        blurb: 'What the market is asking for in your field, priced and dated, from postings employers actually published. It is being switched on in stages.',
    },
    missions: {
        feature: 'Goals',
        blurb: 'The one thing you are working toward, paced week by week. It is being switched on in stages.',
    },
} as const;

type Props = {
    /** What they were trying to open, in the words the product uses for it. */
    feature: string;
    reason: 'not_enabled' | 'error';
    /** One line on what this feature is, so the visit is not wasted. */
    blurb?: string;
};

export function FeatureUnavailable({ feature, reason, blurb }: Props) {
    const isError = reason === 'error';
    const Icon = isError ? TriangleAlert : Clock;

    return (
        <main className="mx-auto flex min-h-[60vh] w-full max-w-[520px] flex-col justify-center px-4 py-16">
            <div className="rounded-xl border border-border bg-card p-6">
                <Icon
                    className={isError ? 'size-5 text-destructive' : 'size-5 text-muted-foreground'}
                    aria-hidden
                />
                <h1 className="mt-3 font-heading text-xl font-semibold tracking-tight text-foreground">
                    {isError ? `${feature} could not load` : `${feature} is not switched on yet`}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    {isError
                        ? 'Something on our side failed, not something you did. Nothing was lost — try again in a moment.'
                        : (blurb ??
                          'We turn features on in stages so the first people through get a working version rather than an early one.')}
                </p>
                {!isError ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        Nothing you have recorded is affected, and you will not be charged for it
                        until you can use it.
                    </p>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                    {!isError ? (
                        <Button asChild size="sm">
                            <a href={waitlistHref(feature)}>
                                <Bell className="size-4" aria-hidden />
                                Tell me when it&apos;s ready
                            </a>
                        </Button>
                    ) : null}
                    {/* /app resolves to the user's actual home (chat when it is on). */}
                    <Button asChild size="sm" variant={isError ? 'default' : 'outline'}>
                        <Link href="/app">Go to Patronus</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                        <Link href="/build">Tailor a resume</Link>
                    </Button>
                </div>
            </div>
        </main>
    );
}
