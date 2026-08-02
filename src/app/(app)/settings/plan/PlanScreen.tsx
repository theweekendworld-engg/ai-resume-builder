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
import { QuotaMeter, formatWinDate, typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  CAREER_PLAN,
  COMPARISON_PLANS,
  FREE_FOREVER_PROMISE,
  NO_DELETION_PROMISE,
  PLAN_COMPARISON,
  SEARCH_PLAN,
  priceFor,
  type PriceKey,
} from '@/lib/plans';
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
export function PlanScreen({ data }: { data: PlanPageData }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

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

  return (
    <main className="mx-auto w-full max-w-[880px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className={cn(typeStyles.h1, 'text-foreground')}>Plan</h1>
        <p className={cn(typeStyles.body, 'mt-1 text-muted-foreground')}>{FREE_FOREVER_PROMISE}</p>
      </header>

      {notice ? (
        <p className={cn(typeStyles.caption, 'mb-4 rounded-lg border border-border px-3 py-2 text-foreground')}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={cn(typeStyles.caption, 'mb-4 text-danger')}>
          {error}
        </p>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Current plan                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="current-plan" className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="current-plan" className={cn(typeStyles.h2, 'text-foreground')}>
              {data.planName}
            </h2>
            <p className={cn(typeStyles.caption, 'text-muted-foreground')}>{data.planBlurb}</p>
          </div>
          {data.priceLabel ? (
            <p className={cn(typeStyles.body, 'num text-foreground')}>{data.priceLabel}</p>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {career?.active ? (
            <SubscriptionLine
              label={CAREER_PLAN.name}
              sub={career}
              onReactivate={null}
            />
          ) : null}
          {search?.active ? (
            <SubscriptionLine
              label={SEARCH_PLAN.name}
              sub={search}
              onReactivate={search.cancelAtPeriodEnd ? onReactivate : null}
            />
          ) : null}
        </dl>

        {career?.pastDue || search?.pastDue ? (
          <p className={cn(typeStyles.caption, 'mt-4 rounded-lg border border-warning/40 px-3 py-2 text-warning')}>
            Your last payment didn&apos;t go through. You keep everything for 14 days while you
            update the card — nothing is locked and nothing is deleted.
          </p>
        ) : null}

        {!data.enforced ? (
          <p className={cn(typeStyles.caption, 'mt-4 text-muted-foreground')}>
            Limits are shown but not enforced yet. We&apos;ll tell you before that changes.
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Proactive downgrade                                               */}
      {/* ---------------------------------------------------------------- */}
      {data.downgradeOffer ? (
        <ProactiveDowngradeCard offer={data.downgradeOffer} className="mt-6" />
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Usage                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="usage" className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 id="usage" className={cn(typeStyles.h2, 'text-foreground')}>
          Usage
        </h2>
        <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>
          Every limit on your plan, so you never find one by hitting it.
        </p>

        <ul className="mt-4 space-y-4">
          {visibleUsage.map((line) => (
            <li key={line.action}>
              <UsageRow line={line} />
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Change plan                                                       */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="change-plan"
        className="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 id="change-plan" className={cn(typeStyles.h2, 'text-foreground')}>
          Change plan
        </h2>

        <div className="mt-4 flex flex-wrap gap-3">
          {!career?.active
            ? CAREER_PLAN.prices.map((price) => (
                <Button
                  key={price.key}
                  type="button"
                  variant={price.recommended ? 'default' : 'outline'}
                  disabled={busy === price.key || !data.billingConfigured}
                  onClick={() => onCheckout(price.key)}
                >
                  {CAREER_PLAN.name} · {price.label}
                </Button>
              ))
            : null}

          {data.canAddSearch ? (
            <Button
              type="button"
              variant={career?.active ? 'default' : 'outline'}
              disabled={busy === 'search_monthly' || !data.billingConfigured}
              onClick={() => onCheckout('search_monthly')}
            >
              Add {SEARCH_PLAN.name} · {priceFor('search_monthly').label}
            </Button>
          ) : null}

          {search?.active && !search.cancelAtPeriodEnd ? (
            <TurnOffSearchButton endsOn={search.currentPeriodEnd} />
          ) : null}
        </div>

        <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>
          {SEARCH_PLAN.name} sits on top of {CAREER_PLAN.name} and is
          billed separately, so turning it off leaves everything else exactly as it was.
        </p>

        <Separator className="my-5" />
        <ComparisonTable />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Billing + leaving                                                 */}
      {/* ---------------------------------------------------------------- */}
      <section
        aria-labelledby="billing"
        className="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 id="billing" className={cn(typeStyles.h2, 'text-foreground')}>
          Billing
        </h2>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onPortal}
            disabled={busy === 'portal' || !data.billingConfigured}
          >
            Update payment and invoices
          </Button>
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
  if (!line.available) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(typeStyles.body, 'text-muted-foreground')}>{line.label}</span>
        <span className={cn(typeStyles.caption, 'text-muted-foreground')}>Not on this plan</span>
      </div>
    );
  }

  if (line.limit === null) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(typeStyles.body, 'text-foreground')}>{line.label}</span>
        <span className={cn(typeStyles.caption, 'text-muted-foreground')}>Unlimited</span>
      </div>
    );
  }

  return (
    <div>
      <p className={cn(typeStyles.body, 'text-foreground')}>{line.label}</p>
      <QuotaMeter
        className="mt-1.5"
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
        <caption className={cn(typeStyles.caption, 'pb-3 text-left text-muted-foreground')}>
          What each plan includes
        </caption>
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
          {PLAN_COMPARISON.map((row) => (
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
