import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { getAdminUserUsage } from '@/actions/admin';
import type { AdminUserUsageData } from '@/actions/admin';

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

type Props = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserUsagePage({ params }: Props) {
  const { userId } = await params;

  let data: AdminUserUsageData;
  try {
    data = await getAdminUserUsage(userId);
  } catch {
    redirect('/dashboard');
  }

  const summary = data.currentMonthSummary;
  const tokenUsagePct = summary && data.limits.maxMonthlyTokens > 0
    ? Math.min(100, Math.round((summary.totalTokens / data.limits.maxMonthlyTokens) * 100))
    : 0;
  const costUsagePct = summary && data.limits.maxMonthlyCostUsd > 0
    ? Math.min(100, Math.round((summary.totalCostUsd / data.limits.maxMonthlyCostUsd) * 100))
    : 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Admin / User Usage</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.user.fullName || data.user.userId}</h1>
          <p className="text-sm text-muted-foreground">{data.user.email || data.user.userId}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to Admin
          </Link>
          <UserButton />
        </div>
      </header>

      <section className="mb-8 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Month Tokens</p>
          <p className="mt-2 text-2xl font-semibold">{summary?.totalTokens.toLocaleString() ?? 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tokenUsagePct}% of limit</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Month Cost</p>
          <p className="mt-2 text-2xl font-semibold">{formatUsd(summary?.totalCostUsd ?? 0)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{costUsagePct}% of limit</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Generations</p>
          <p className="mt-2 text-2xl font-semibold">{summary?.totalGenerations ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">PDFs Stored</p>
          <p className="mt-2 text-2xl font-semibold">{summary?.totalPdfs ?? 0}</p>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Operation Breakdown (Last 30 Days)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Operation</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.operationBreakdown.map((row) => (
                <tr key={row.operation} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium">{row.operation}</td>
                  <td className="py-2 pr-4">{row.calls}</td>
                  <td className="py-2 pr-4">{row.tokens.toLocaleString()}</td>
                  <td className="py-2">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Daily Usage Trend (Last 30 Days)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Date (UTC)</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((row) => (
                <tr key={row.date} className="border-b border-border/60">
                  <td className="py-2 pr-4">{row.date}</td>
                  <td className="py-2 pr-4">{row.calls}</td>
                  <td className="py-2 pr-4">{row.tokens.toLocaleString()}</td>
                  <td className="py-2">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Recent API Usage Logs</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Time (UTC)</th>
                <th className="py-2 pr-4">Operation</th>
                <th className="py-2 pr-4">Provider / Model</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2 pr-4">Latency</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentLogs.map((log) => (
                <tr key={log.id} className="border-b border-border/60">
                  <td className="py-2 pr-4">{log.createdAt.toISOString()}</td>
                  <td className="py-2 pr-4 font-medium">{log.operation}</td>
                  <td className="py-2 pr-4">{log.provider} / {log.model}</td>
                  <td className="py-2 pr-4">{log.totalTokens.toLocaleString()}</td>
                  <td className="py-2 pr-4">{formatUsd(log.costUsd)}</td>
                  <td className="py-2 pr-4">{log.latencyMs} ms</td>
                  <td className="py-2">{log.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
