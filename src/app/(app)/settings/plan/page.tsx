import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

import { getPlanPageData, reconcileCheckout, reconcileDodoCheckout } from '@/actions/billing';

import { PlanScreen } from './PlanScreen';

/**
 * `/settings/plan` (design/02 §J3).
 *
 * One server round trip, then the client screen. The `?checkout=` parameter is
 * the post-Stripe redirect: we reconcile it *before* reading the plan data so
 * someone who just paid sees what they paid for immediately rather than
 * waiting on a webhook (PRD 06 §5.1). The webhook then writes the same row with
 * the same values, and the slot-keyed upsert makes that a no-op.
 */
export const metadata = {
  title: 'Plan · Patronus',
};

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; subscription_id?: string; status?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const params = await searchParams;
  // Say what happened on the way back from checkout. Before this, both the
  // success and the cancel return rendered the page with no acknowledgement.
  let checkoutNotice: string | null = null;
  const dodoReturn = dodoReturnParams(params);
  if (params.checkout === 'cancelled') {
    checkoutNotice = 'Checkout cancelled. Nothing was charged.';
  } else if (dodoReturn) {
    // Dodo Payments appends `subscription_id` and `status` to the return URL.
    // Both are hints: the reconcile reads the subscription from Dodo itself
    // and checks it is this user's. `status` only picks the wording.
    const reconciled = await reconcileDodoCheckout({ subscriptionId: dodoReturn.subscriptionId });
    checkoutNotice = reconciled.success
      ? `You're on ${reconciled.data.planName}. Thank you.`
      : dodoReturn.status === 'failed'
        ? "The payment didn't go through, so nothing was charged. You can try again below."
        : 'Payment received? It can take a minute to show here. Refresh shortly.';
  } else if (params.checkout) {
    // Failure here is not fatal: the webhook is the backstop, and the page
    // still renders whatever state we do have.
    const reconciled = await reconcileCheckout(params.checkout);
    checkoutNotice = reconciled.success
      ? `You're on ${reconciled.data.planName}. Thank you.`
      : 'Payment received? It can take a minute to show here. Refresh shortly.';
  }

  const result = await getPlanPageData();
  // `getPlanPageData` re-derives identity from the session rather than taking a
  // userId: it is a server action, and an action that accepted one would hand
  // any caller someone else's plan. The redirect above already covers the only
  // way this can fail.
  if (!result.success) redirect('/sign-in');

  return <PlanScreen data={result.data} checkoutNotice={checkoutNotice} />;
}

/**
 * Read the Dodo return. Our return URL is `?checkout=dodo`; if the provider
 * appended its own parameters with a second `?` instead of `&`, they arrive
 * inside `checkout`, so parse them out of there too.
 */
function dodoReturnParams(params: {
  checkout?: string;
  subscription_id?: string;
  status?: string;
}): { subscriptionId: string | null; status: string | null } | null {
  const raw = params.checkout ?? '';
  if (raw !== 'dodo' && !raw.startsWith('dodo?')) return null;
  const tail = new URLSearchParams(raw.slice('dodo?'.length));
  return {
    subscriptionId: params.subscription_id ?? tail.get('subscription_id'),
    status: params.status ?? tail.get('status'),
  };
}
