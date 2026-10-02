import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOpsSnapshot, type OpsSnapshot } from '@/actions/ops';
import { DeadJobActions } from '@/components/admin/DeadJobActions';

export const dynamic = 'force-dynamic';

function usd(value: number, dp = 4): string {
    return `$${value.toFixed(dp)}`;
}

function ms(value: number | null): string {
    if (value === null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function pct(numerator: number, denominator: number): string {
    if (denominator === 0) return '—';
    return `${Math.round((numerator / denominator) * 100)}%`;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="surface-work mb-8 rounded-xl border border-border p-5">
            <header className="mb-4">
                <h2 className="font-heading text-base font-semibold">{title}</h2>
                {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
            </header>
            {children}
        </section>
    );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
    return (
        <th className={`border-b border-border pb-2 text-xs font-medium text-muted-foreground ${right ? 'text-right' : 'text-left'}`}>
            {children}
        </th>
    );
}

function Td({ children, right, tone }: { children: React.ReactNode; right?: boolean; tone?: 'danger' | 'warning' | 'muted' }) {
    const toneClass =
        tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'muted' ? 'text-muted-foreground' : '';
    return <td className={`num py-2 text-sm ${right ? 'text-right' : ''} ${toneClass}`}>{children}</td>;
}

export default async function OpsPage() {
    let snap: OpsSnapshot;
    try {
        snap = await getOpsSnapshot(24);
    } catch {
        redirect('/dashboard');
    }

    const breaches = snap.cost.filter((c) => c.breached);
    const unhealthy = snap.health.filter((check) => !check.ok);
    const totalDead = snap.jobs.reduce((n, j) => n + j.dead, 0);

    return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <header className="mb-8 flex items-baseline justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">Admin</p>
                    <h1 className="font-heading text-2xl font-semibold tracking-tight">Operations</h1>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <span className="num text-muted-foreground">
                        last {snap.windowHours}h · {snap.generatedAt.toISOString().slice(11, 16)} UTC
                    </span>
                    <Link href="/admin" className="text-muted-foreground transition-colors hover:text-foreground">
                        Usage
                    </Link>
                </div>
            </header>

            <Section title="Config health" hint="What the switched-on features need, by name. A failing check means users hit that failure.">
                {unhealthy.length === 0 ? (
                    <p className="text-sm text-muted-foreground">All checks pass.</p>
                ) : (
                    <table className="w-full">
                        <thead><tr><Th>Check</Th><Th>Impact</Th><Th>Set</Th></tr></thead>
                        <tbody>
                            {unhealthy.map((check) => (
                                <tr key={check.id}>
                                    <Td tone={check.severity === 'error' ? 'danger' : 'warning'}>{check.id}</Td>
                                    <Td>{check.impact}</Td>
                                    <Td tone="muted">{check.fix}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            {(breaches.length > 0 || totalDead > 0) && (
                <div className="mb-8 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
                    <p className="font-medium text-warning">Needs attention</p>
                    <ul className="mt-1 list-inside list-disc text-muted-foreground">
                        {breaches.map((b) => (
                            <li key={b.feature}>
                                <span className="num">{b.feature}</span> is over its cost tripwire at{' '}
                                <span className="num">{usd(b.avgCostUsd)}</span>/call — investigate a retry loop or an
                                uncached call, do not downgrade the model
                            </li>
                        ))}
                        {totalDead > 0 && (
                            <li>
                                <span className="num">{totalDead}</span> dead job(s): retry or discard them below
                            </li>
                        )}
                    </ul>
                </div>
            )}

            <Section
                title="Activation funnel"
                hint="R1 north star: log-fill rate — users with 3+ confirmed Wins by day 21"
            >
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {[
                        { label: 'Profiles', value: snap.funnel.signups },
                        { label: 'Source connected', value: snap.funnel.sourceConnected },
                        { label: 'First Win confirmed', value: snap.funnel.firstWinConfirmed },
                        { label: '3+ Wins', value: snap.funnel.threeWinsBy21Days },
                    ].map((tile) => (
                        <div key={tile.label} className="rounded-lg border border-border p-4">
                            <p className="num font-heading text-2xl font-semibold">{tile.value}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{tile.label}</p>
                        </div>
                    ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                    Log-fill rate: <span className="num">{pct(snap.funnel.threeWinsBy21Days, snap.funnel.signups)}</span>{' '}
                    · target 40%. Source-connected counts users with an active connector.
                </p>
            </Section>

            <Section title="Jobs" hint="Queue health by kind. `dead` means retries are exhausted and nothing will run it again.">
                {snap.jobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No jobs in this window.</p>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr>
                                <Th>Kind</Th>
                                <Th right>Pending</Th>
                                <Th right>Running</Th>
                                <Th right>Succeeded</Th>
                                <Th right>Failed</Th>
                                <Th right>Dead</Th>
                                <Th right>Avg</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {snap.jobs.map((j) => (
                                <tr key={j.kind}>
                                    <Td>{j.kind}</Td>
                                    <Td right>{j.pending}</Td>
                                    <Td right>{j.running}</Td>
                                    <Td right>{j.succeeded}</Td>
                                    <Td right tone={j.failed > 0 ? 'warning' : undefined}>{j.failed}</Td>
                                    <Td right tone={j.dead > 0 ? 'danger' : undefined}>{j.dead}</Td>
                                    <Td right tone="muted">{ms(j.avgDurationMs)}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            {snap.dead.length > 0 && (
                <Section title="Dead letters" hint="Exhausted retries. Retry requeues it now; discard deletes it. Both are recorded.">
                    <table className="w-full">
                        <thead>
                            <tr>
                                <Th>Kind</Th>
                                <Th right>Attempts</Th>
                                <Th>Error</Th>
                                <Th>Action</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {snap.dead.map((d) => (
                                <tr key={d.id}>
                                    <Td>{d.kind}</Td>
                                    <Td right>{d.attempts}</Td>
                                    <Td tone="muted">
                                        <span className="line-clamp-1 font-mono text-xs">{d.lastError ?? '—'}</span>
                                    </Td>
                                    <Td>
                                        <DeadJobActions jobId={d.id} />
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Section>
            )}

            <Section
                title="Cost per feature"
                hint="Tripwires are defect detectors, not spend controls — a breach means a retry loop or a missing cache."
            >
                {snap.cost.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No model calls in this window.</p>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr>
                                <Th>Feature</Th>
                                <Th right>Calls</Th>
                                <Th right>Total</Th>
                                <Th right>Avg/call</Th>
                                <Th right>Tripwire</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {snap.cost.map((c) => (
                                <tr key={c.feature}>
                                    <Td tone={c.feature === 'untagged' ? 'warning' : undefined}>{c.feature}</Td>
                                    <Td right>{c.calls}</Td>
                                    <Td right>{usd(c.totalCostUsd, 4)}</Td>
                                    <Td right tone={c.breached ? 'danger' : undefined}>{usd(c.avgCostUsd, 6)}</Td>
                                    <Td right tone="muted">{c.tripwireUsd === null ? '—' : usd(c.tripwireUsd, 2)}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                    An <span className="num">untagged</span> row means a call skipped the feature tag — the tripwires
                    cannot see it.
                </p>
            </Section>

            <Section title="Email" hint="Bounce and complaint rates drive domain reputation; watch them before volume grows.">
                {snap.email.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No sends in this window.</p>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr>
                                <Th>Template</Th>
                                <Th right>Sent</Th>
                                <Th right>Delivered</Th>
                                <Th right>Opened</Th>
                                <Th right>Bounced</Th>
                                <Th right>Complained</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {snap.email.map((e) => (
                                <tr key={e.template}>
                                    <Td>{e.template}</Td>
                                    <Td right>{e.sent}</Td>
                                    <Td right>{e.delivered}</Td>
                                    <Td right tone="muted">{pct(e.opened, e.sent)}</Td>
                                    <Td right tone={e.bounced > 0 ? 'warning' : undefined}>{e.bounced}</Td>
                                    <Td right tone={e.complained > 0 ? 'danger' : undefined}>{e.complained}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>
        </div>
    );
}
