'use client';

import * as React from 'react';

import {
  createBillingPortalSession,
  exportEverything,
  reactivateSearch,
  requestRefund,
  startCheckout,
} from '@/actions/billing';
import type { PlanPageData, UsageLineView } from '@/actions/billing.types';
import { ProactiveDowngradeCard } from '@/components/paywall';
import { PageHeader, QuotaMeter, formatWinDate, pageContainer, typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import {
  CAREER_PLAN,
  COMPARISON_PLANS,
  FREE_FOREVER_PROMISE,
  NO_DELETION_PROMISE,
  builtComparisonRows,
  SEARCH_PLAN,
  priceFor,
  type PriceKey,
} from '@/lib/plans';
import { BILLING_UNAVAILABLE_COPY } from '@/lib/billing/provider';
import { cn } from '@/lib/utils';

import { CancelDialog, downloadJson } from './CancelDialog';

/**
 * `/settings/plan` (design/02 §J3, PRD 06 §6).
 *
 * The page someone opens when they are thinking about leaving, so it is built
 * to make leaving easy and staying informed: usage against every limit, the
 * export button in plain sight, and cancel one click away rather than buried
 * three screens deep behind a chat widget.
 *
 * Nothing here renders a `Tier` value. Names come from `PLAN_CATALOG`.
 */
export function PlanScreen({ data, checkoutNotice = null }: { data: PlanPageData; checkoutNotice?: string | null }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(checkoutNotice);

  async function go(key: string, run: () => Promise<{ url: string } | null>) {
    setBusy(key);
    setError(null);
    try {
      const result = await run();
      if (result?.url) window.location.href = result.url;
    } finally {
      setBusy(null);
    }
  }

  async function onCheckout(plan: PriceKey) {
    await go(plan, async () => {
      const result = await startCheckout(plan);
      if (!result.success) {
        setError(result.error);
        return null;
      }
      return result.data;
    });
  }

  async function onPortal() {
    await go('portal', async () => {
      const result = await createBillingPortalSession();
      if (!result.success) {
        setError(result.error);
        return null;
      }
      return result.data;
    });
  }

  async function onReactivate() {
    await go('reactivate', async () => {
      const result = await reactivateSearch();
      if (!result.success) {
        setError(result.error);
        return null;
      }
      if (!result.data.url) setNotice('Search is back on. Nothing changed on your bill.');
      return result.data.url ? { url: result.data.url } : null;
    });
  }

  async function onExport() {
    setBusy('export');
    setError(null);
    const result = await exportEverything();
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    downloadJson(result.data.filename, result.data.json);
    setNotice('Downloaded. Every win, packet and resume, as JSON.');
  }

  async function onRefund() {
    setBusy('refund');
    setError(null);
    const result = await requestRefund();
    setBusy(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setNotice('Refunded. Your record stays exactly where it is.');
  }

  const search = data.search;
  const career = data.career;
  const visibleUsage = data.usage.filter((line) => line.available || line.used > 0);

  const currentPlan = COMPARISON_PLANS.find((plan) => plan.tier === data.tier) ?? null;

  return (
    <main>
      <PageHeader title="Plan" description={FREE_FOREVER_PROMISE} />
      <div className={cn(pageContainer, 'py-6')}>

      {notice ? (
        <p className={cn(typeStyles.small, 'mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-foreground')}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={cn(typeStyles.small, 'mb-4 rounded-lg border border-danger/40 px-3 py-2 text-danger')}>
          {error}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Current plan                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="current-plan" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div>
              <p className={cn(typeStyles.caption, 'uppercase tracking-wide text-muted-foreground')}>Your plan</p>
              <h2 id="current-plan" className="font-heading text-xl font-semibold text-foreground">
                {data.planName}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{data.planBlurb}</span>
              </h2>
            </div>
          </div>
          {data.priceLabel ? (
            <p className="num font-heading text-lg font-semibold text-foreground">{data.priceLabel}</p>
          ) : null}
        </div>

        {career?.active || search?.active ? (
          <dl className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {career?.active ? <SubscriptionLine label={CAREER_PLAN.name} sub={career} onReactivate={null} /> : null}
            {search?.active ? (
              <SubscriptionLine label={SEARCH_PLAN.name} sub={search} onReactivate={search.cancelAtPeriodEnd ? onReactivate : null} />
            ) : null}
          </dl>
        ) : null}

        {career?.pastDue || search?.pastDue ? (
          <p className={cn(typeStyles.caption, 'mt-4 rounded-lg border border-warning/40 px-3 py-2 text-warning')}>
            Your last payment didn&apos;t go through. You keep everything for 14 days while you
            update the card — nothing is locked and nothing is deleted.
          </p>
        ) : null}
      </section>

      {data.downgradeOffer ? <ProactiveDowngradeCard offer={data.downgradeOffer} className="mt-6" /> : null}

      {/* ---------------------------------------------------------------- */}
      {/* Usage: a grid of small meters, not a column of empty bars.        */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="usage" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="usage" className="font-heading text-base font-semibold text-foreground">Usage</h2>
          <p className={cn(typeStyles.caption, 'text-muted-foreground')}>
            {data.enforced
              ? 'Every limit on your plan, so you never find one by hitting it.'
              : 'Limits are shown but not enforced yet. We\u2019ll tell you before that changes.'}
          </p>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleUsage.map((line) => (
            <li key={line.action} className="rounded-xl border border-border bg-card px-4 py-3.5">
              <UsageRow line={line} />
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Change plan: the three plans side by side.                        */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="change-plan" className="mt-8">
        <h2 id="change-plan" className="font-heading text-base font-semibold text-foreground">Change plan</h2>

        {/* No provider can take money yet: say so, instead of rendering
            buttons that are silently disabled or fail on click. */}
        {!data.billingConfigured ? (
          <p role="status" className={cn(typeStyles.small, 'mt-3 rounded-lg border border-border bg-card px-4 py-3 text-foreground')}>
            {BILLING_UNAVAILABLE_COPY}
          </p>
        ) : null}

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {COMPARISON_PLANS.map((plan) => {
            const isCurrent = currentPlan?.tier === plan.tier;
            const price = plan.prices.find((p) => p.recommended) ?? plan.prices[0] ?? null;
            return (
              <article
                key={plan.name}
                className={cn(
                  'flex flex-col rounded-xl border bg-card p-5',
                  isCurrent ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-heading text-base font-semibold text-foreground">{plan.name}</h3>
                  {isCurrent ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Current</span>
                  ) : null}
                </div>
                <p className="num mt-2 font-heading text-2xl font-semibold text-foreground">
                  {price ? price.label : '$0'}
                </p>
                <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>{price ? price.cadence : 'forever'}</p>
                <p className={cn(typeStyles.small, 'mt-3 flex-1 text-muted-foreground')}>{plan.audience}</p>

                <div className="mt-4 flex flex-col gap-2">
                  {plan.tier === CAREER_PLAN.tier && data.billingConfigured && !career?.active
                    ? CAREER_PLAN.prices.map((p) => (
                        <Button
                          key={p.key}
                          type="button"
                          variant={p.recommended ? 'default' : 'outline'}
                          disabled={busy === p.key}
                          onClick={() => onCheckout(p.key)}
                        >
                          {CAREER_PLAN.name} · {p.label}
                        </Button>
                      ))
                    : null}
                  {plan.tier === SEARCH_PLAN.tier && data.billingConfigured && data.canAddSearch ? (
                    <Button type="button" disabled={busy === 'search_monthly'} onClick={() => onCheckout('search_monthly')}>
                      Add {SEARCH_PLAN.name} · {priceFor('search_monthly').label}
                    </Button>
                  ) : null}
                  {plan.tier === SEARCH_PLAN.tier && !search?.active && !data.canAddSearch ? (
                    <p className={cn(typeStyles.caption, 'text-muted-foreground')}>Added on top of {CAREER_PLAN.name}.</p>
                  ) : null}
                  {plan.tier === SEARCH_PLAN.tier && search?.active && !search.cancelAtPeriodEnd ? (
                    <TurnOffSearchButton endsOn={search.currentPeriodEnd} />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>
          {SEARCH_PLAN.name} sits on top of {CAREER_PLAN.name} and is
          billed separately, so turning it off leaves everything else exactly as it was.
        </p>

        <details className="group mt-4 rounded-xl border border-border bg-card">
          <summary className={cn(typeStyles.small, 'cursor-pointer list-none px-5 py-3 font-medium text-foreground')}>
            Compare everything each plan includes
          </summary>
          <div className="border-t border-border px-5 py-4">
            <ComparisonTable />
          </div>
        </details>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Billing + leaving                                                 */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="billing" className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 id="billing" className="font-heading text-base font-semibold text-foreground">
          Billing and your data
        </h2>

        <div className="mt-4 flex flex-wrap gap-3">
          {data.portalAvailable ? (
            <Button
              type="button"
              variant="outline"
              onClick={onPortal}
              disabled={busy === 'portal'}
            >
              Update payment and invoices
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onExport} disabled={busy === 'export'}>
            Export everything
          </Button>
          {data.refundEligibleUntil ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onRefund}
              disabled={busy === 'refund'}
            >
              Refund (until {formatWinDate(data.refundEligibleUntil)})
            </Button>
          ) : null}
          {career?.active && !career.cancelAtPeriodEnd ? (
            <CancelDialog
              planLabel={CAREER_PLAN.name}
              accessUntil={career.currentPeriodEnd}
            />
          ) : null}
        </div>

        <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>
          {NO_DELETION_PROMISE}
        </p>
      </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function SubscriptionLine({
  label,
  sub,
  onReactivate,
}: {
  label: string;
  sub: NonNullable<PlanPageData['career']>;
  onReactivate: (() => void) | null;
}) {
  const date = sub.currentPeriodEnd ? formatWinDate(sub.currentPeriodEnd) : null;
  return (
    <div>
      <dt className={cn(typeStyles.caption, 'text-muted-foreground')}>{label}</dt>
      <dd className={cn(typeStyles.body, 'num text-foreground')}>
        {sub.cancelAtPeriodEnd
          ? date
            ? `Ends ${date}`
            : 'Ends at period end'
          : date
            ? `Renews ${date}`
            : 'Active'}
        {sub.priceLabel ? (
          <span className="text-muted-foreground"> · {sub.priceLabel}</span>
        ) : null}
      </dd>
      {onReactivate ? (
        <Button type="button" variant="link" size="sm" className="px-0" onClick={onReactivate}>
          Turn it back on
        </Button>
      ) : null}
    </div>
  );
}

function UsageRow({ line }: { line: UsageLineView }) {
  if (!line.available || line.limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(typeStyles.small, line.available ? 'text-foreground' : 'text-muted-foreground')}>{line.label}</span>
        <span className={cn(typeStyles.caption, 'shrink-0 text-muted-foreground')}>
          {line.available ? 'Unlimited' : 'Not on this plan'}
        </span>
      </div>
    );
  }

  return (
    <div>
      <p className={cn(typeStyles.small, 'truncate font-medium text-foreground')}>{line.label}</p>
      <QuotaMeter
        className="mt-2"
        used={line.used}
        limit={line.limit}
        resetsOn={line.resetsOn ?? undefined}
        unit={line.scope === 'lifetime' ? 'lifetime' : undefined}
      />
    </div>
  );
}

/**
 * The user-initiated version of §5.3. Same action, same one-confirm posture —
 * it just isn't us who raised it this time.
 */
function TurnOffSearchButton({ endsOn }: { endsOn: string | null }) {
  return (
    <ProactiveDowngradeCard
      offer={{
        trigger: 'user_initiated',
        headline: `Turn ${SEARCH_PLAN.name} off?`,
        detail: `You keep ${CAREER_PLAN.name} and everything in it.`,
        keeps: 'Your log, your record, your packets, and Radar all stay.',
        searchEndsOn: endsOn,
      }}
      className="w-full"
    />
  );
}

function ComparisonTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className={cn(typeStyles.caption, 'pb-2 pr-3 font-medium text-muted-foreground')}>
              &nbsp;
            </th>
            {COMPARISON_PLANS.map((plan) => (
              <th
                key={plan.name}
                scope="col"
                className={cn(typeStyles.caption, 'pb-2 pr-3 font-medium text-foreground')}
              >
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Built rows only. This table used to render in full to the
              customer at the moment they choose a plan, selling multi-step
              apply orchestration, interview prep, the negotiation mission,
              1:1 prep and ATS auto-fix — none of which exist. The marketing
              page had already made that judgement and curated around it; the
              buyer is the audience that most needed it. */}
          {builtComparisonRows().map((row) => (
            <tr key={row.label} className="border-t border-border/60">
              <th
                scope="row"
                className={cn(typeStyles.caption, 'py-2 pr-3 font-normal text-muted-foreground')}
              >
                {row.label}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={COMPARISON_PLANS[index].name}
                  className={cn(typeStyles.caption, 'num py-2 pr-3 text-foreground')}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
