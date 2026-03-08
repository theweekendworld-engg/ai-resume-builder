import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { getAdminDashboardData, refreshCurrentUsageSummaries } from '@/actions/admin';
import type { AdminDashboardData } from '@/actions/admin';

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export default async function AdminDashboardPage() {
  let data: AdminDashboardData;
  try {
    data = await getAdminDashboardData();
  } catch {
    redirect('/dashboard');
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Admin</p>
          <h1 className="text-2xl font-semibold tracking-tight">Usage and Cost Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Dashboard
          </Link>
          <UserButton />
        </div>
      </header>

      <form action={refreshCurrentUsageSummaries} className="mb-6">
        <button
          type="submit"
          className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/80"
        >
          Refresh Monthly Summaries
        </button>
      </form>

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Today</p>
          <p className="mt-2 text-2xl font-semibold">{data.usage.today.tokens.toLocaleString()} tokens</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatUsd(data.usage.today.costUsd)} • {data.usage.today.calls} calls</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">This Week</p>
          <p className="mt-2 text-2xl font-semibold">{data.usage.week.tokens.toLocaleString()} tokens</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatUsd(data.usage.week.costUsd)} • {data.usage.week.calls} calls</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">This Month</p>
          <p className="mt-2 text-2xl font-semibold">{data.usage.month.tokens.toLocaleString()} tokens</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatUsd(data.usage.month.costUsd)} • {data.usage.month.calls} calls</p>
        </div>
      </section>

      <section className="mb-8 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Generations Completed</p>
          <p className="mt-2 text-2xl font-semibold">{data.generations.completed}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Generations Failed</p>
          <p className="mt-2 text-2xl font-semibold">{data.generations.failed}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Generation Sessions</p>
          <p className="mt-2 text-2xl font-semibold">{data.generations.total}</p>
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Cost by Operation (Month)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">Operation</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2">Avg Latency</th>
              </tr>
            </thead>
            <tbody>
              {data.operationBreakdown.map((row) => (
                <tr key={row.operation} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium">{row.operation}</td>
                  <td className="py-2 pr-4">{row.calls}</td>
                  <td className="py-2 pr-4">{row.tokens.toLocaleString()}</td>
                  <td className="py-2 pr-4">{formatUsd(row.costUsd)}</td>
                  <td className="py-2">{row.avgLatencyMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Top Users by Cost (Month)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Calls</th>
                <th className="py-2 pr-4">Tokens</th>
                <th className="py-2 pr-4">Cost</th>
                <th className="py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {data.topUsers.map((user) => (
                <tr key={user.userId} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-medium">{user.fullName || user.userId}</td>
                  <td className="py-2 pr-4">{user.email || '-'}</td>
                  <td className="py-2 pr-4">{user.calls}</td>
                  <td className="py-2 pr-4">{user.tokens.toLocaleString()}</td>
                  <td className="py-2 pr-4">{formatUsd(user.costUsd)}</td>
                  <td className="py-2">
                    <Link href={`/admin/${user.userId}`} className="text-primary hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
