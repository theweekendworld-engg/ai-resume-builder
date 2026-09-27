'use client';

import * as React from 'react';
import Link from 'next/link';

import { recordPaywallCta, recordPaywallShown, startCheckout } from '@/actions/billing';
import { typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { SOFT_MODE_NOTE, type PaywallContent } from './copy';

export interface PaywallProps {
  /**
   * Built server-side by `./data`, or by the surface that owns the numbers
   * (Radar, Missions). `null` renders nothing — loaders return `null` when the
   * user has no data of their own, and that decision is theirs to make.
   */
  content: PaywallContent | null;
  /**
   * Soft mode: the action still completed. Say so, rather than letting a
   * paywall imply a block that didn't happen.
   */
  softAllowed?: boolean;
  className?: string;
}

/**
 * A paywall (PRD 06 §4).
 *
 * Inline and non-blocking by construction. There is no modal variant, no
 * countdown, no "offer ends", and no interstitial — those are banned by the
 * PRD and there is deliberately no prop that could switch them on.
 *
 * `paywall_shown` is recorded once per mount, server-side, with `hasOwnData` in
 * the payload so we can audit the rule above rather than trust it.
 */
export function Paywall({ content, softAllowed = false, className }: PaywallProps) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const code = content?.code;

  React.useEffect(() => {
    if (!code) return;
    void recordPaywallShown({ code, hasOwnData: true });
  }, [code]);

  if (!content || !content.hasOwnData) return null;

  async function onUpgrade() {
    if (!content) return;
    setPending(true);
    setError(null);
    void recordPaywallCta({ code: content.code, targetTier: content.targetTier });
    const result = await startCheckout(content.priceKey, { paywallCode: content.code });
    if (result.success) {
      window.location.href = result.data.url;
      return;
    }
    setError(result.error);
    setPending(false);
  }

  const banner = content.tone === 'banner';

  return (
    <section
      aria-label={`Upgrade: ${content.headline}`}
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-4 sm:px-5',
        banner ? 'bg-gradient-to-r from-primary/5 to-transparent' : null,
        className
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={cn(typeStyles.body, 'num font-medium text-foreground')}>
            {content.headline}
          </p>
          <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>{content.body}</p>
          {softAllowed ? (
            <p className={cn(typeStyles.caption, 'mt-2 text-warning')}>{SOFT_MODE_NOTE}</p>
          ) : null}
        </div>

        <Button
          type="button"
          onClick={onUpgrade}
          disabled={pending}
          className="shrink-0 self-start sm:self-auto"
        >
          {pending ? 'Opening checkout…' : content.ctaLabel}
        </Button>
      </div>

      {error ? (
        <p role="alert" className={cn(typeStyles.caption, 'mt-3 text-foreground')}>
          {error}{' '}
          {/* A refused checkout (no provider yet, Career required first) must
              never be a dead end: the plan page explains the options. */}
          <Link href="/settings/plan" className="underline underline-offset-2">
            See plans
          </Link>
        </p>
      ) : null}
    </section>
  );
}
