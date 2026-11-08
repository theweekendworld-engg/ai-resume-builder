import type { ReactNode } from 'react';
import { CONTACT_EMAIL, OPERATOR, OPERATOR_LOCATION } from './Contact';

/**
 * The layout every policy page shares: a title, the date it last changed, who
 * operates the service, and short sections. Plain on purpose — these pages are
 * read by people deciding whether to trust us, and by a payment gateway's
 * review, and both want the facts, not a design.
 */

export const POLICY_UPDATED = '27 September 2026';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-6">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-xs text-muted-foreground">
                Last updated {POLICY_UPDATED} · Patronus is operated by {OPERATOR}, {OPERATOR_LOCATION} ·{' '}
                <a href={`mailto:${CONTACT_EMAIL}`} className="underline-offset-4 hover:underline">
                    {CONTACT_EMAIL}
                </a>
            </p>
            <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
        </section>
    );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
    return (
        <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">{heading}</h2>
            <div className="mt-2 space-y-3">{children}</div>
        </div>
    );
}
