'use client';

import * as React from 'react';

import { declineDowngradeOffer, recordDowngradeOffered, turnOffSearch } from '@/actions/billing';
import type { DowngradeOffer } from '@/actions/billing.types';
import { formatWinDate, typeStyles } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProactiveDowngradeCardProps {
  offer: DowngradeOffer | null;
  /** Called after Search is turned off, so the surface can refresh. */
  onTurnedOff?: (endsOn: string | null, remainingPlan: string) => void;
  className?: string;
}

/**
 * "You don't need Search any more — want us to turn it off?" (PRD 06 §5.3)
 *
 * This is the product's whole posture in one card, so a few things about it are
 * not negotiable:
 *
 *   - **We** raise it. The user did not have to go looking for the off switch.
 *   - Turning it off is the *primary* button. Keeping it is the quiet one.
 *     Inverting that would make this a retention prompt wearing a costume.
 *   - It names what they keep, because the reason people don't cancel things
 *     is that they can't tell what they'd lose.
 *   - It ends at the period they already paid for. Never mid-period.
 *
 * The bet is that volunteering this increases lifetime revenue. If it doesn't,
 * `proactive_downgrade_accepted` → `search_reactivated` will say so.
 */
export function ProactiveDowngradeCard({
  offer,
  onTurnedOff,
  className,
}: ProactiveDowngradeCardProps) {
  const [state, setState] = React.useState<'open' | 'dismissed' | 'done'>('open');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<{ endsOn: string | null; plan: string } | null>(
    null
  );

  const trigger = offer?.trigger;

  React.useEffect(() => {
    if (!trigger) return;
    void recordDowngradeOffered(trigger);
  }, [trigger]);

  if (!offer || state === 'dismissed') return null;

  if (state === 'done' && outcome) {
    return (
      <section
        className={cn('rounded-xl border border-border bg-card px-4 py-4 sm:px-5', className)}
      >
        <p className={cn(typeStyles.body, 'text-foreground')}>
          Search is off{outcome.endsOn ? ` from ${formatWinDate(outcome.endsOn)}` : ''}.
        </p>
        <p className={cn(typeStyles.caption, 'mt-1 text-muted-foreground')}>
          You&apos;re on {outcome.plan}. Turn Search back on in one click whenever you need it —
          your setup is kept.
        </p>
      </section>
    );
  }

  async function onTurnOff() {
    if (!offer) return;
    setPending(true);
    setError(null);
    const result = await turnOffSearch({ trigger: offer.trigger });
    if (!result.success) {
      setError(result.error);
      setPending(false);
      return;
    }
    setOutcome({ endsOn: result.data.endsOn, plan: result.data.remainingPlan });
    setState('done');
    onTurnedOff?.(result.data.endsOn, result.data.remainingPlan);
  }

  async function onKeep() {
    if (!offer) return;
    setState('dismissed');
    void declineDowngradeOffer(offer.trigger);
  }

  return (
    <section
      aria-label="Turn Search off"
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-5 sm:px-5',
        'bg-gradient-to-b from-primary/5 to-transparent',
        className
      )}
    >
      <h2 className={cn(typeStyles.h2, 'text-foreground')}>{offer.headline}</h2>
      <p className={cn(typeStyles.body, 'mt-2 text-muted-foreground')}>{offer.detail}</p>
      <p className={cn(typeStyles.body, 'mt-2 text-muted-foreground')}>{offer.keeps}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onTurnOff} disabled={pending}>
          {pending ? 'Turning Search off…' : 'Turn off Search'}
        </Button>
        <Button type="button" variant="ghost" onClick={onKeep} disabled={pending}>
          Keep it for now
        </Button>
      </div>

      <p className={cn(typeStyles.caption, 'mt-3 text-muted-foreground')}>
        {offer.searchEndsOn
          ? `You keep Search until ${formatWinDate(offer.searchEndsOn)} — you've paid for it. You can turn it back on in one click whenever you need it.`
          : 'You can turn it back on in one click whenever you need it.'}
      </p>

      {error ? (
        <p role="alert" className={cn(typeStyles.caption, 'mt-3 text-danger')}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
