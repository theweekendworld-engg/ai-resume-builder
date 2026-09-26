import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAgentRunsSnapshot, type AgentRunsSnapshot } from '@/actions/agentOps';

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

export default async function AgentRunsPage() {
    let snap: AgentRunsSnapshot;
    try {
        snap = await getAgentRunsSnapshot(24);
    } catch {
        redirect('/dashboard');
    }

    const totalRuns = snap.runs.reduce((n, row) => n + row.n, 0);

    return (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <header className="mb-8 flex items-baseline justify-between">
                <div>
                    <p className="text-sm text-muted-foreground">Admin</p>
                    <h1 className="font-heading text-2xl font-semibold tracking-tight">Agent runs</h1>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <span className="num text-muted-foreground">
                        last {snap.windowHours}h · {snap.generatedAt.toISOString().slice(11, 16)} UTC
                    </span>
                    <Link href="/admin/ops" className="text-muted-foreground transition-colors hover:text-foreground">
                        Operations
                    </Link>
                </div>
            </header>

            <Section title="Runs by status" hint={`${totalRuns} Scout runs. Partial means at least one section was unavailable — not a failure.`}>
                <div className="flex flex-wrap gap-6">
                    {snap.runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs in this window.</p> : null}
                    {snap.runs.map((row) => (
                        <div key={row.status}>
                            <p className="num text-2xl font-semibold">{row.n}</p>
                            <p className="text-xs text-muted-foreground">{row.status} · {pct(row.n, totalRuns)}</p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="By kind" hint="Cost is model spend plus search credits, per run.">
                <table className="w-full">
                    <thead><tr><Th>Kind</Th><Th right>Runs</Th><Th right>Avg cost</Th><Th right>p50 duration</Th></tr></thead>
                    <tbody>
                        {snap.kinds.map((row) => (
                            <tr key={row.kind ?? 'none'}>
                                <Td>{row.kind ?? 'unclassified'}</Td>
                                <Td right>{row.n}</Td>
                                <Td right>{usd(row.avgCostUsd)}</Td>
                                <Td right>{ms(row.p50Ms)}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Sections" hint="Every attempt counts. A high unavailable share usually means a missing key or thin public data; a high failed share is a bug.">
                <table className="w-full">
                    <thead>
                        <tr><Th>Section</Th><Th right>Attempts</Th><Th right>OK</Th><Th right>Unavailable</Th><Th right>Failed</Th><Th right>Skipped</Th><Th right>p50</Th><Th right>p95</Th><Th right>Avg cost</Th></tr>
                    </thead>
                    <tbody>
                        {snap.steps.map((row) => (
                            <tr key={row.name}>
                                <Td>{row.name}</Td>
                                <Td right>{row.total}</Td>
                                <Td right>{pct(row.succeeded, row.total)}</Td>
                                <Td right tone={row.unavailable > 0 ? 'warning' : 'muted'}>{row.unavailable}</Td>
                                <Td right tone={row.failed > 0 ? 'danger' : 'muted'}>{row.failed}</Td>
                                <Td right tone="muted">{row.skipped}</Td>
                                <Td right>{ms(row.p50Ms)}</Td>
                                <Td right>{ms(row.p95Ms)}</Td>
                                <Td right>{usd(row.avgCostUsd)}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Top reasons" hint="Failed and unavailable steps, grouped by the reason shown to users.">
                <table className="w-full">
                    <thead><tr><Th>Section</Th><Th>Reason</Th><Th right>n</Th></tr></thead>
                    <tbody>
                        {snap.topReasons.map((row) => (
                            <tr key={`${row.name}:${row.reason}`}>
                                <Td>{row.name}</Td>
                                <Td tone="muted">{row.reason}</Td>
                                <Td right>{row.n}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Recent failed and partial runs">
                <table className="w-full">
                    <thead><tr><Th>Run</Th><Th>Status</Th><Th>Kind</Th><Th>Error</Th><Th right>Cost</Th></tr></thead>
                    <tbody>
                        {snap.recentProblems.map((run) => (
                            <tr key={run.id}>
                                <Td>
                                    <Link href={`/admin/runs/${run.id}`} className="underline-offset-2 hover:underline">
                                        {run.id.slice(-8)}
                                    </Link>
                                </Td>
                                <Td tone={run.status === 'failed' ? 'danger' : 'warning'}>{run.status}</Td>
                                <Td tone="muted">{run.kind ?? '—'}</Td>
                                <Td tone="muted">{run.error ?? '—'}</Td>
                                <Td right>{usd(run.costUsd)}</Td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Research cache" hint="Shared across users. The efficiency lever: the tenth user to share the same company pays for fit only.">
                <p className="num text-sm">
                    {snap.cache.live} live of {snap.cache.total} entries
                    {snap.cache.byKind.length ? ` · ${snap.cache.byKind.map((row) => `${row.kind} ${row.n}`).join(' · ')}` : ''}
                </p>
            </Section>
        </div>
    );
}
