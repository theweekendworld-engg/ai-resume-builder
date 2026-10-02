import type { UserUsageStats } from '@/actions/usage';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type UsageSectionProps = {
  result: UserUsageStats;
};

export function UsageSection({ result }: UsageSectionProps) {

  if (!result.success) {
    return (
      <div className="space-y-6">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">
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
        <h2 className="font-heading text-lg font-semibold tracking-tight">Usage</h2>
        <p className="text-sm text-muted-foreground">Your usage for {monthLabel}.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/*
          A dollar figure and a raw token count were here.
          Removed: neither is a fact about the user, they are facts about
          our supplier bill. A customer on a $5 plan does not benefit from
          learning their resume cost us 23 cents — it invites the question
          of why the plan is $5, and it exposes a number that moves when we
          change model. What they need is what the plan promised: how many
          resumes are left. Cost stays in /admin, where a decision is made
          from it.
        */}
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
