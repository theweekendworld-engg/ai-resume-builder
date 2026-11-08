import Link from 'next/link';
import { CONTACT_EMAIL, OPERATOR, OPERATOR_LOCATION } from './Contact';
import { POLICY_LINKS, START_FREE_HREF } from './links';
import { Wordmark } from './Wordmark';

/**
 * The contact address is imported rather than retyped — it is published in two
 * places on this page and the second copy is exactly where an address goes
 * stale. Same reasoning as prices coming from `PLAN_CATALOG`.
 */
export function Footer() {
    return (
        <footer className="border-t border-border bg-background">
            <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-xs space-y-3">
                        <Wordmark />
                        <p className="text-[13px] leading-relaxed text-muted-foreground">
                            The private, evidence-backed record of your working life.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-x-14 gap-y-8">
                        <div>
                            <p className="eyebrow">
                                Product
                            </p>
                            <div className="mt-4 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
                                <Link href="/score" className="rounded-sm transition-colors duration-150 hover:text-foreground">
                                    Check resume
                                </Link>
                                <Link
                                    href="/#how-it-works"
                                    className="rounded-sm transition-colors duration-150 hover:text-foreground"
                                >
                                    How it works
                                </Link>
                                <Link
                                    href="/#job-search"
                                    className="rounded-sm transition-colors duration-150 hover:text-foreground"
                                >
                                    Job search
                                </Link>
                                <Link
                                    href={START_FREE_HREF}
                                    className="rounded-sm transition-colors duration-150 hover:text-foreground"
                                >
                                    Start free
                                </Link>
                            </div>
                        </div>

                        <div>
                            <p className="eyebrow">
                                Company
                            </p>
                            <div className="mt-4 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
                                {POLICY_LINKS.map((link) => (
                                    <Link key={link.href} href={link.href} className="rounded-sm transition-colors duration-150 hover:text-foreground">
                                        {link.label}
                                    </Link>
                                ))}
                                <a
                                    href={`mailto:${CONTACT_EMAIL}`}
                                    className="rounded-sm transition-colors duration-150 hover:text-foreground"
                                >
                                    {CONTACT_EMAIL}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-12 border-t border-border pt-6">
                    <p className="text-xs text-muted-foreground">
                        Never sold, never used to train anything. Operated by {OPERATOR}, {OPERATOR_LOCATION}.
                    </p>
                </div>
            </div>
        </footer>
    );
}
