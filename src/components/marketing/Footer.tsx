import Link from 'next/link';
import { CONTACT_EMAIL, OPERATOR, OPERATOR_LOCATION } from './Contact';
import { POLICY_LINKS, START_FREE_HREF } from './links';

/**
 * The contact address is imported rather than retyped — it is published in two
 * places on this page and the second copy is exactly where an address goes
 * stale. Same reasoning as prices coming from `PLAN_CATALOG`.
 */
export function Footer() {
    return (
        <footer className="border-t border-border/60 bg-background">
            <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-xs space-y-3">
                        <div className="flex items-center gap-2.5">
                            <img
                                src="/logo.png"
                                alt=""
                                className="h-8 w-auto drop-shadow-[0_0_8px_hsl(190_100%_50%/0.45)]"
                            />
                            <p className="font-heading text-base font-bold tracking-tight text-foreground">
                                Patronus
                            </p>
                        </div>
                        <p className="text-[13px] leading-relaxed text-muted-foreground/70">
                            The private, evidence-backed record of your working life.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-x-14 gap-y-8">
                        <div>
                            <p className="ledger text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/50">
                                Product
                            </p>
                            <div className="mt-4 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
                                <Link href="/score" className="transition-colors hover:text-primary">
                                    Check resume
                                </Link>
                                <Link
                                    href="/#how-it-works"
                                    className="transition-colors hover:text-primary"
                                >
                                    How it works
                                </Link>
                                <Link
                                    href={START_FREE_HREF}
                                    className="transition-colors hover:text-primary"
                                >
                                    Start free
                                </Link>
                            </div>
                        </div>

                        <div>
                            <p className="ledger text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/50">
                                Company
                            </p>
                            <div className="mt-4 flex flex-col gap-2.5 text-[13px] text-muted-foreground">
                                {POLICY_LINKS.map((link) => (
                                    <Link key={link.href} href={link.href} className="transition-colors hover:text-primary">
                                        {link.label}
                                    </Link>
                                ))}
                                <a
                                    href={`mailto:${CONTACT_EMAIL}`}
                                    className="transition-colors hover:text-primary"
                                >
                                    {CONTACT_EMAIL}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-12 border-t border-border/40 pt-6">
                    <p className="text-xs text-muted-foreground/50">
                        Never sold, never used to train anything. Operated by {OPERATOR}, {OPERATOR_LOCATION}.
                    </p>
                </div>
            </div>
        </footer>
    );
}
