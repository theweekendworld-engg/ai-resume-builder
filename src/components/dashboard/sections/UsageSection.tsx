import type { UserUsageStats } from '@/actions/usage';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type UsageSectionProps = {
  result: UserUsageStats;
};

export function UsageSection({ result }: UsageSectionProps) {

  if (!result.success) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">
          {result.error ?? 'Failed to load usage stats.'}
        </p>
      </div>
    );
  }

  const s = result.stats!;
  const monthLabel = s.monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">Your usage for {monthLabel}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tokens used</CardDescription>
            <CardTitle className="text-2xl">{s.totalTokens.toLocaleString()}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost (USD)</CardDescription>
            <CardTitle className="text-2xl">${s.totalCostUsd.toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Generations completed</CardDescription>
            <CardTitle className="text-2xl">{s.generationsCompleted}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Generations failed</CardDescription>
            <CardTitle className="text-2xl">{s.generationsFailed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>PDFs generated</CardDescription>
            <CardTitle className="text-2xl">{s.pdfsGenerated}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
