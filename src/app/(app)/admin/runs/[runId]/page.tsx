import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAgentRunTrace, type AgentRunTrace } from '@/actions/agentOps';

export const dynamic = 'force-dynamic';

function ms(value: number | null): string {
    if (value === null) return '—';
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function sourcesOf(value: unknown): { url: string; title: string | null }[] {
    return Array.isArray(value) ? (value as { url: string; title: string | null }[]) : [];
}

export default async function AgentRunTracePage({ params }: { params: Promise<{ runId: string }> }) {
    const { runId } = await params;
    let trace: AgentRunTrace | null;
    try {
        trace = await getAgentRunTrace(runId);
    } catch {
        redirect('/dashboard');
    }
    if (!trace) notFound();
    const { run, steps, modelCalls } = trace;

    return (
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
            <header className="mb-6">
                <Link href="/admin/runs" className="text-sm text-muted-foreground hover:text-foreground">← Agent runs</Link>
                <h1 className="mt-2 font-heading text-xl font-semibold tracking-tight">
                    {run.agent} · {run.kind ?? 'unclassified'} · {run.status}
                </h1>
                <p className="num mt-1 text-xs text-muted-foreground">
                    {run.id} · user {run.userId} · ${run.costUsd.toFixed(4)} · workflow {run.workflowRunId ?? '—'}
                </p>
                {run.error ? <p className="mt-2 text-sm text-danger">{run.error}</p> : null}
                <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border p-3 text-xs">{JSON.stringify(run.input, null, 2)}</pre>
            </header>

            <section className="surface-work mb-8 rounded-xl border border-border p-5">
                <h2 className="mb-3 font-heading text-base font-semibold">Steps</h2>
                <ol className="space-y-3">
                    {steps.map((step) => (
                        <li key={step.id} className="border-b border-border pb-3 last:border-0">
                            <div className="flex items-baseline justify-between gap-4 text-sm">
                                <span className="font-medium">{step.name} <span className="text-muted-foreground">#{step.attempt}</span></span>
                                <span className="num text-muted-foreground">{step.status} · {ms(step.latencyMs)} · ${step.costUsd.toFixed(4)}</span>
                            </div>
                            {step.reason ? <p className="mt-1 text-xs text-muted-foreground">{step.reason}</p> : null}
                            {step.error && step.error !== step.reason ? <p className="mt-1 text-xs text-danger">{step.error}</p> : null}
                            {sourcesOf(step.sources).length ? (
                                <ul className="mt-1 space-y-0.5">
                                    {sourcesOf(step.sources).map((source) => (
                                        <li key={source.url} className="truncate text-xs">
                                            <a href={source.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-2 hover:underline">
                                                {source.title || source.url}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </li>
                    ))}
                </ol>
            </section>

            <section className="surface-work rounded-xl border border-border p-5">
                <h2 className="mb-3 font-heading text-base font-semibold">Model calls</h2>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-2">Operation</th><th className="pb-2">Model</th><th className="pb-2 text-right">In</th><th className="pb-2 text-right">Out</th><th className="pb-2 text-right">Cost</th><th className="pb-2 text-right">Latency</th><th className="pb-2 text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {modelCalls.map((call, index) => (
                            <tr key={index} className="num">
                                <td className="py-1">{call.operation}</td>
                                <td className="py-1 text-muted-foreground">{call.model}</td>
                                <td className="py-1 text-right">{call.inputTokens}</td>
                                <td className="py-1 text-right">{call.outputTokens}</td>
                                <td className="py-1 text-right">${(call.costUsd ?? 0).toFixed(5)}</td>
                                <td className="py-1 text-right">{ms(call.latencyMs)}</td>
                                <td className="py-1 text-right">{call.status}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
