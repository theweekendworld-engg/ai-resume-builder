/**
 * J4 — the money loop (docs/impl/04 §4, PRD 06).
 *
 * Free user hits a quota → paywall with their real data → checkout → tier
 * changes → limits change → Search on top → Search off → cancel → **data
 * intact**.
 *
 * The last clause is the point of the whole journey. Everything else here is
 * plumbing that can be fixed in an afternoon; a cancellation that removes a Win
 * is unrecoverable trust damage in a product whose entire pitch is "we keep the
 * record of your working life". So the cancel hop asserts survival by id, row
 * by row, for Wins, Evidence, ClaimLinks, ImpactMetrics and a packet — not by
 * a count that a coincidence could satisfy.
 *
 * Three things this journey refuses to shortcut:
 *
 *   - **Entitlements change only through the webhook.** Writing `Subscription`
 *     directly would test the assertion, not the system. Every tier transition
 *     below goes through `POST /api/stripe/webhook` with a signature the mock
 *     computes the same way the real library verifies it.
 *   - **Enforcement is really on.** `.env.test` pins `ENTITLEMENTS_ENFORCE=false`
 *     so quota gates never fail an unrelated suite for the wrong reason. A
 *     journey about the paywall has to turn it on, and puts it back afterwards.
 *   - **Search is a second subscription, not a bigger one.** Turning it off has
 *     to leave Career standing, which is only observable if the two are
 *     genuinely separate rows driven by separate Stripe objects.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { GroundState, PacketStatus, PacketType, Tier, WinStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';
import { gateMeteredAction, getSubscriptionState } from '@/lib/entitlements';
import { PLAN_CATALOG, meteredLimit, planName } from '@/lib/plans';
import {
    assertGrounded,
    assertNoDeadJobs,
    assertPurged,
    defineJourney,
    drainJobs,
    purge,
} from './harness';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

/** Free's context-interview trial, read from the catalog rather than assumed. */
const TRIAL = meteredLimit(Tier.free, 'context_interview').limit;

const WEBHOOK_SECRET = 'whsec_journey_d4';

const PRICE_IDS = {
    STRIPE_PRICE_CAREER_MONTHLY: 'price_j4_career_monthly',
    STRIPE_PRICE_SEARCH_MONTHLY: 'price_j4_search_monthly',
} as const;

const journey = defineJourney({
    name: 'money-loop',
    boundaries: ['stripe', 'openai', 'qdrant'],
    stripeWebhookSecret: WEBHOOK_SECRET,
});

// After `defineJourney`, so Clerk is mocked before these bind `auth()`.
const billing = await import('@/actions/billing');
const wins = await import('@/actions/wins');
const backfill = await import('@/actions/backfill');
const experiences = await import('@/actions/experiences');
const extensionResume = await import('@/lib/extension/resume');
const webhook = await import('@/app/api/stripe/webhook/route');

// ─────────────────────────────────────────────────────────── environment
//
// Process-global, so both of these are captured and restored: Bun runs every
// test file in one process and a leaked `ENTITLEMENTS_ENFORCE=true` would turn
// some other suite's soft gate hard.

const envBackup = new Map<string, string | undefined>();

function setEnv(name: string, value: string): void {
    if (!envBackup.has(name)) envBackup.set(name, process.env[name]);
    process.env[name] = value;
}

let restoreFlag: (() => Promise<void>) | null = null;

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
    setEnv('ENTITLEMENTS_ENFORCE', 'true');
    setEnv('STRIPE_SECRET_KEY', 'sk_test_journey_d4');
    setEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    for (const [name, value] of Object.entries(PRICE_IDS)) setEnv(name, value);

    // The metered action this journey spends is `context_interview`, which is
    // behind the backfill flag. Enabled for this run's user only.
    const existing = await prisma.featureFlag.findUnique({ where: { key: 'backfill' } });
    const before = Array.isArray(existing?.allowUserIds) ? (existing.allowUserIds as string[]) : [];
    await prisma.featureFlag.upsert({
        where: { key: 'backfill' },
        create: {
            key: 'backfill',
            enabled: false,
            description: 'Career OS: backfill',
            allowUserIds: [journey.userId],
        },
        update: { allowUserIds: [...before, journey.userId] },
    });
    invalidateFlagCache();

    restoreFlag = async () => {
        if (existing) {
            await prisma.featureFlag.update({
                where: { key: 'backfill' },
                data: { allowUserIds: before },
            });
        } else {
            await prisma.featureFlag.deleteMany({ where: { key: 'backfill' } });
        }
        invalidateFlagCache();
    };
});

afterAll(async () => {
    await restoreFlags(__flagSnapshot);
    for (const [name, value] of envBackup) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    await restoreFlag?.();
});

// ─────────────────────────────────────────── the model script + stripe state
//
// `resetMocks()` wipes both the scripted drafter and the Stripe object store
// after every test, so anything a later hop needs to read back is re-installed
// here rather than seeded once.

type Seed = {
    id: string;
    customer: string;
    priceId: string;
    metadata: Record<string, string>;
    status?: 'active' | 'canceled';
    cancelAtPeriodEnd?: boolean;
};

/** Far enough out that the journey does not start failing on a calendar date. */
const PERIOD_END_SECONDS = Math.floor(Date.UTC(2030, 0, 1) / 1000);

const stripeSeeds: Seed[] = [];

function reseedStripe(): void {
    for (const seed of stripeSeeds) {
        journey.m.stripe.seedSubscription({ ...seed, currentPeriodEnd: PERIOD_END_SECONDS });
    }
}

beforeEach(() => {
    reseedStripe();
    // The interview only needs to open; one clean question is enough.
    journey.m.openai.onObject('You are helping a working professional reconstruct accomplishments', {
        object: { acknowledgement: '', question: 'What are you most known for from that time?' },
    });
});

// ────────────────────────────────────────────────────────────── helpers

/** Every user-visible string this journey produced. Audited at the end. */
const userFacing: { where: string; text: string }[] = [];

function record(where: string, ...texts: (string | null | undefined)[]): void {
    for (const text of texts) {
        if (typeof text === 'string' && text.length > 0) userFacing.push({ where, text });
    }
}

async function postWebhook(
    type: string,
    object: unknown,
    options: { signature?: string } = {},
): Promise<{ status: number; body: unknown }> {
    const event = journey.m.stripe.event(type, object);
    const request = new NextRequest('https://patronus.test/api/stripe/webhook', {
        method: 'POST',
        headers: {
            'stripe-signature': options.signature ?? event.signature,
            'content-type': 'application/json',
        },
        body: event.payload,
    });
    const response = await webhook.POST(request);
    return { status: response.status, body: await response.json() };
}

/**
 * Run checkout for a price the way the app does, then deliver the
 * `checkout.session.completed` Stripe would send. Returns the ids so a later
 * hop can drive the same subscription.
 */
async function checkoutAndSettle(price: 'career_monthly' | 'search_monthly') {
    const started = await billing.startCheckout(price, { paywallCode: 'PW1' });
    expect(started).toMatchObject({ success: true });
    if (!started.success) throw new Error('checkout did not start');

    const checkoutId = new URL(started.data.url).pathname.replace(/^\//, '');
    const session = (await journey.m.stripe.checkout.sessions.retrieve(
        checkoutId,
    )) as unknown as {
        id: string;
        customer: string;
        subscription: string;
        client_reference_id: string;
        metadata: Record<string, string>;
    };

    const seed: Seed = {
        id: session.subscription,
        customer: session.customer,
        priceId: PRICE_IDS[price === 'career_monthly' ? 'STRIPE_PRICE_CAREER_MONTHLY' : 'STRIPE_PRICE_SEARCH_MONTHLY'],
        metadata: { userId: journey.userId },
    };
    stripeSeeds.push(seed);
    reseedStripe();

    const delivered = await postWebhook('checkout.session.completed', {
        ...session,
        amount_total: PLAN_CATALOG[price === 'career_monthly' ? Tier.always_on : Tier.pro].prices[0]
            .amountCents,
    });
    expect(delivered).toEqual({ status: 200, body: { received: true } });

    return { checkoutId, subscriptionId: session.subscription, customerId: session.customer, seed };
}

async function usageLine(action: string) {
    const page = await billing.getPlanPageData();
    expect(page).toMatchObject({ success: true });
    if (!page.success) throw new Error('plan page unavailable');
    const line = page.data.usage.find((entry) => entry.action === action);
    if (!line) throw new Error(`no usage line for ${action}`);
    return { page: page.data, line };
}

// ────────────────────────────────────────────────── what must survive it all

const seeded = {
    winIds: [] as string[],
    evidenceIds: [] as string[],
    claimLinkIds: [] as string[],
    impactMetricIds: [] as string[],
    packetId: '',
    /** Dated before the Free plan's 90-day window, so "hidden not deleted" is testable. */
    oldWinId: '',
};

let careerSubscriptionId = '';
let searchSubscriptionId = '';
let employerAId = '';
let employerBId = '';

// ═════════════════════════════════════════ 1. a record worth paying to keep

test('a free user builds a record of their own', async () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000);
    const lastWeek = new Date(Date.now() - 7 * 86_400_000);

    const drafts = [
        {
            occurredAt: twoYearsAgo,
            draft: {
                title: 'Rebuilt the ingest pipeline',
                narrative: 'Replaced the nightly batch with a streaming ingest.',
                category: 'shipped' as const,
                quantified: true,
                impact: { metric: 'ingest lag', baseline: '6 hours', result: '4 minutes' },
            },
        },
        {
            occurredAt: lastWeek,
            draft: {
                title: 'Fixed the checkout retry storm',
                narrative: 'Traced the duplicate charges to an unbounded retry.',
                category: 'fixed' as const,
            },
        },
        {
            occurredAt: lastWeek,
            draft: {
                title: 'Mentored two engineers onto the on-call rota',
                narrative: 'Ran shadow shifts until they were comfortable.',
                category: 'grew' as const,
            },
        },
    ];

    for (const [index, entry] of drafts.entries()) {
        const created = await wins.createWinFromText({
            draft: entry.draft,
            occurredAt: entry.occurredAt,
            source: 'manual',
        });
        expect(created).toMatchObject({ success: true });
        if (!created.success) return;
        seeded.winIds.push(created.data.id);
        if (index === 0) seeded.oldWinId = created.data.id;
    }

    for (const winId of seeded.winIds) {
        const confirmed = await wins.confirmWin(winId);
        expect(confirmed).toMatchObject({ success: true });
        await assertGrounded(winId);
    }
    await drainJobs();

    const [evidence, links, metrics] = await Promise.all([
        prisma.evidence.findMany({ where: { userId: journey.userId }, select: { id: true } }),
        prisma.claimLink.findMany({ where: { userId: journey.userId }, select: { id: true } }),
        prisma.impactMetric.findMany({ where: { userId: journey.userId }, select: { id: true } }),
    ]);
    seeded.evidenceIds = evidence.map((row) => row.id);
    seeded.claimLinkIds = links.map((row) => row.id);
    seeded.impactMetricIds = metrics.map((row) => row.id);

    expect(seeded.evidenceIds.length).toBeGreaterThan(0);
    expect(seeded.claimLinkIds.length).toBeGreaterThan(0);
    expect(seeded.impactMetricIds.length).toBe(1);

    // A packet is the other thing a cancelling user would be terrified of
    // losing. Seeded directly: generating one is J2's loop, and here it is the
    // subject of a durability assertion rather than a step in this one.
    const packet = await prisma.reviewPacket.create({
        data: {
            userId: journey.userId,
            type: PacketType.brag_doc,
            status: PacketStatus.ready,
            periodStart: new Date(Date.now() - 180 * 86_400_000),
            periodEnd: new Date(),
            winIds: seeded.winIds,
            content: { summary: 'A year of shipping.' },
        },
        select: { id: true },
    });
    seeded.packetId = packet.id;

    const experienceA = (await experiences.createUserExperience({
        company: 'Acme',
        role: 'Staff Engineer',
        startDate: '2022-01',
        endDate: '2023-12',
    })) as { success: boolean; experienceId?: string };
    const experienceB = (await experiences.createUserExperience({
        company: 'Northwind',
        role: 'Senior Engineer',
        startDate: '2019-01',
        endDate: '2021-12',
    })) as { success: boolean; experienceId?: string };
    employerAId = experienceA.experienceId ?? '';
    employerBId = experienceB.experienceId ?? '';
    expect(employerAId).not.toBe('');
    expect(employerBId).not.toBe('');
});

// ═══════════════════════════════════ 2. the plan surface, before any money

test('the free plan surface shows the user their own numbers, named from the catalog', async () => {
    const { page, line } = await usageLine('context_interview');

    expect(page.tier).toBe(Tier.free);
    expect(page.planName).toBe(PLAN_CATALOG.free.name);
    expect(page.enforced).toBe(true);
    expect(page.billingConfigured).toBe(true);
    expect(page.career).toBeNull();
    expect(page.search).toBeNull();

    // Nobody should discover a limit by hitting it: every action is listed,
    // including the ones this plan does not include.
    expect(page.usage.length).toBeGreaterThan(5);
    // The size of the free allowance is an operator knob; that it is a
    // LIFETIME one, fully unspent, and shown to the user is the journey.
    expect(line).toMatchObject({
        used: 0,
        limit: TRIAL,
        remaining: TRIAL,
        scope: 'lifetime',
        available: true,
    });

    record('planPage', page.planName, page.planBlurb, page.priceLabel);
    for (const entry of page.usage) record('planPage.usage', entry.label);
});

// ═══════════════════════════════ 3. consume to the limit, then hit the wall

test('a free user spends their whole lifetime trial', async () => {
    // Free is a trial of the product rather than a locked version of it, so
    // this is however many the trial is — the point is that it runs out and
    // never refills, not that it is one.
    const opened = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: employerAId,
        subjectLabel: 'Acme',
        entryPoint: 'log_menu',
    });
    expect(opened).toMatchObject({ success: true });

    for (let spent = 1; spent < TRIAL; spent += 1) {
        await gateMeteredAction(journey.userId, 'context_interview');
    }

    const { line } = await usageLine('context_interview');
    expect(line).toMatchObject({ used: TRIAL, limit: TRIAL, remaining: 0, scope: 'lifetime' });
    // Nothing to wait for. That is what makes the next screen an upgrade
    // prompt rather than "come back next month".
    expect(line.resetsOn).toBeNull();
});

test('the next call is refused, with the numbers from their own record', async () => {
    const refused = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: employerBId,
        subjectLabel: 'Northwind',
        entryPoint: 'log_menu',
    });

    expect(refused).toMatchObject({ success: false, code: 'entitlement_required' });
    if (refused.success) return;

    // Their real limit and the plan that continues it, not a placeholder.
    expect(refused.error).toContain(String(TRIAL));
    expect(refused.error).toContain(PLAN_CATALOG.always_on.name);
    record('entitlement refusal', refused.error);

    // Refused means refused: no second session, and the counter did not move.
    expect(await prisma.interviewSession.count({ where: { userId: journey.userId } })).toBe(1);
    const { line } = await usageLine('context_interview');
    expect(line).toMatchObject({ used: TRIAL, remaining: 0 });

    const exhausted = await prisma.funnelEvent.findFirst({
        where: { userId: journey.userId, type: 'quota_exhausted' },
    });
    expect((exhausted?.payload as Record<string, unknown>)?.action).toBe('context_interview');

    // The paywall records that it had the user's own data to show — the field
    // PRD 06 §4 exists to make auditable.
    const shown = await billing.recordPaywallShown({ code: 'PW1', hasOwnData: true });
    expect(shown).toMatchObject({ success: true });
    const event = await prisma.funnelEvent.findFirst({
        where: { userId: journey.userId, type: 'paywall_shown' },
    });
    const payload = event?.payload as Record<string, unknown>;
    expect(payload?.hasOwnData).toBe(true);
    record('paywall_shown.tier', payload?.tier as string);
});

// ═════════════════════════════════ 4. checkout, then the webhook flips the tier

test('checkout alone grants nothing; a signed webhook is what changes the tier', async () => {
    const started = await billing.startCheckout('career_monthly', { paywallCode: 'PW1' });
    expect(started).toMatchObject({ success: true });
    if (!started.success) return;

    // Money moved in Stripe; entitlements have not.
    expect((await getSubscriptionState(journey.userId)).tier).toBe(Tier.free);

    const checkoutStarted = await prisma.funnelEvent.findFirst({
        where: { userId: journey.userId, type: 'checkout_started' },
    });
    const checkoutPayload = checkoutStarted?.payload as Record<string, unknown>;
    expect(checkoutPayload?.amount).toBe(500);
    record('checkout_started.tier', checkoutPayload?.tier as string);

    const checkoutId = new URL(started.data.url).pathname.replace(/^\//, '');
    const session = (await journey.m.stripe.checkout.sessions.retrieve(checkoutId)) as unknown as {
        subscription: string;
        customer: string;
    };
    careerSubscriptionId = session.subscription;
    stripeSeeds.push({
        id: careerSubscriptionId,
        customer: session.customer,
        priceId: PRICE_IDS.STRIPE_PRICE_CAREER_MONTHLY,
        metadata: { userId: journey.userId },
    });
    reseedStripe();

    // A forged signature must not move anything. The mock verifies the same
    // HMAC the real library does, so this is the security check running.
    const forged = await postWebhook(
        'checkout.session.completed',
        { ...session, id: checkoutId },
        { signature: 't=1785000000,v1=deadbeef' },
    );
    expect(forged.status).toBe(400);
    expect((await getSubscriptionState(journey.userId)).tier).toBe(Tier.free);

    const delivered = await postWebhook('checkout.session.completed', {
        ...session,
        id: checkoutId,
        amount_total: 9900,
    });
    expect(delivered).toEqual({ status: 200, body: { received: true } });

    const state = await getSubscriptionState(journey.userId);
    expect(state.tier).toBe(Tier.always_on);
    expect(state.career?.active).toBe(true);
    expect(state.career?.stripeSubId).toBe(careerSubscriptionId);
    expect(state.search).toBeNull();

    // Replaying the same event is a no-op, not a second row.
    await postWebhook('checkout.session.completed', { ...session, id: checkoutId, amount_total: 9900 });
    expect(
        await prisma.subscription.count({ where: { userId: { contains: journey.runId } } }),
    ).toBe(1);
});

test('the limit that refused them a minute ago now lets them through', async () => {
    const opened = await backfill.startBackfillSession({
        subjectType: 'employer',
        subjectId: employerBId,
        subjectLabel: 'Northwind',
        entryPoint: 'log_menu',
    });
    expect(opened).toMatchObject({ success: true });
    expect(await prisma.interviewSession.count({ where: { userId: journey.userId } })).toBe(2);

    const { page, line } = await usageLine('context_interview');
    expect(page.tier).toBe(Tier.always_on);
    expect(page.planName).toBe(PLAN_CATALOG.always_on.name);
    // The limit itself changed shape: one for a lifetime became four a period.
    expect(line).toMatchObject({ limit: 4, used: 1, remaining: 3, scope: 'period' });
    expect(line.resetsOn).not.toBeNull();

    record('planPage', page.planName, page.planBlurb, page.priceLabel);
    record('planPage.career', page.career?.planName, page.career?.priceLabel);
});

// ══════════════════════════════════════ 5. Search is a second subscription

test('adding Search creates a second subscription and leaves Career alone', async () => {
    const careerBefore = (await getSubscriptionState(journey.userId)).career;

    const settled = await checkoutAndSettle('search_monthly');
    searchSubscriptionId = settled.subscriptionId;

    const state = await getSubscriptionState(journey.userId);
    expect(state.tier).toBe(Tier.pro);
    expect(state.search?.active).toBe(true);
    expect(state.search?.stripeSubId).toBe(searchSubscriptionId);

    // Two rows, two Stripe objects, one customer.
    expect(state.all.length).toBe(2);
    expect(state.career?.stripeSubId).toBe(careerBefore?.stripeSubId ?? null);
    expect(state.career?.active).toBe(true);
    expect(state.search?.stripeCustomerId).toBe(state.career?.stripeCustomerId ?? null);
    expect(
        await prisma.subscription.findUnique({
            where: { userId_slot: { userId: journey.userId, slot: 'search' } },
            select: { tier: true },
        }),
    ).toMatchObject({ tier: Tier.pro });

    const { page } = await usageLine('tailored_generation');
    expect(page.planName).toBe(PLAN_CATALOG.pro.name);
    expect(page.canAddSearch).toBe(false);
    record('planPage', page.planName, page.planBlurb, page.priceLabel);
    record('planPage.search', page.search?.planName, page.search?.priceLabel);
});

test('turning Search off leaves Career intact rather than dropping to Free', async () => {
    const outcome = await billing.turnOffSearch();
    expect(outcome).toMatchObject({ success: true });
    if (!outcome.success) return;

    expect(outcome.data.remainingPlan).toBe(PLAN_CATALOG.always_on.name);
    record('turnOffSearch.remainingPlan', outcome.data.remainingPlan);

    // Cancels at period end, never mid-period: they paid for the month.
    const update = journey.m.stripe
        .callsTo('subscriptions.update')
        .find((call) => call.args[0] === searchSubscriptionId);
    expect(update?.args[1]).toMatchObject({ cancel_at_period_end: true });
    expect((update?.args[1] as { metadata?: Record<string, string> })?.metadata?.winBack).toBe('1');
    expect((await getSubscriptionState(journey.userId)).tier).toBe(Tier.pro);

    // Period end arrives; Stripe says the Search subscription is gone.
    const ended = journey.m.stripe.seedSubscription({
        id: searchSubscriptionId,
        customer: (await getSubscriptionState(journey.userId)).search?.stripeCustomerId ?? 'cus_j4',
        priceId: PRICE_IDS.STRIPE_PRICE_SEARCH_MONTHLY,
        status: 'canceled',
        currentPeriodEnd: PERIOD_END_SECONDS,
        metadata: { userId: journey.userId },
    });
    expect(await postWebhook('customer.subscription.deleted', ended)).toEqual({
        status: 200,
        body: { received: true },
    });

    const after = await getSubscriptionState(journey.userId);
    // The whole point of §5.3: Career, not Free.
    expect(after.tier).toBe(Tier.always_on);
    expect(after.career?.active).toBe(true);
    expect(after.search?.active).toBe(false);
    // Switched off, not erased — the row survives so reactivation is one click.
    expect(
        await prisma.subscription.count({
            where: { userId: journey.userId, slot: 'search' },
        }),
    ).toBe(1);

    const changed = await prisma.funnelEvent.findMany({
        where: { userId: journey.userId, type: 'plan_changed' },
        orderBy: { occurredAt: 'desc' },
        take: 4,
    });
    for (const event of changed) {
        const payload = event.payload as Record<string, unknown>;
        record('plan_changed', payload?.from as string, payload?.to as string);
    }
    expect(changed.some((event) => (event.payload as Record<string, unknown>)?.to === 'Career')).toBe(
        true,
    );

    // Career features still resolve, and the metered limits with them.
    const { page } = await usageLine('context_interview');
    expect(page.tier).toBe(Tier.always_on);
});

// ══════════════════════════════════ 6. a burned unit comes back on failure

test('a metered action that fails terminally gives the unit back', async () => {
    const before = await usageLine('tailored_generation');
    expect(before.line.used).toBe(0);
    expect(before.line.limit).toBe(15);

    // The workspace was deleted in another tab. The gate has already run.
    await expect(
        extensionResume.startExtensionResumeGeneration({
            userId: journey.userId,
            input: { workspaceId: 'workspace-that-is-gone' },
        }),
    ).rejects.toThrow(/workspace not found/i);

    const { start } = await import('@/lib/usageTracker').then((mod) => ({
        start: mod.getCurrentBillingPeriod().start,
    }));
    const quota = await prisma.usageQuota.findUnique({
        where: {
            userId_periodStart_action: {
                userId: journey.userId,
                periodStart: start,
                action: 'tailored_generation',
            },
        },
        select: { used: true, limit: true },
    });

    // The row proves the gate ran; `used: 0` proves the refund did.
    expect(quota).not.toBeNull();
    expect(quota).toMatchObject({ used: 0, limit: 15 });

    const after = await usageLine('tailored_generation');
    expect(after.line.used).toBe(0);
    expect(after.line.remaining).toBe(15);
});

// ═══════════════════════════════════════════ 7. cancelling deletes nothing

test('cancelling keeps every row the user ever made', async () => {
    // Export sits on the page where someone is thinking about leaving, and it
    // is offered unconditionally rather than used as a retention lever.
    const entered = await billing.enterCancelFlow();
    expect(entered).toMatchObject({ success: true });

    const exported = await billing.exportEverything();
    expect(exported).toMatchObject({ success: true });
    if (!exported.success) return;
    const bundle = JSON.parse(exported.data.json) as {
        wins: { id: string }[];
        evidence: { id: string }[];
        reviewPackets: { id: string }[];
    };
    expect(bundle.wins.map((row) => row.id).sort()).toEqual([...seeded.winIds].sort());
    expect(bundle.reviewPackets.map((row) => row.id)).toContain(seeded.packetId);

    const cancelled = await billing.cancelPlan({
        slot: 'career',
        reason: 'too_expensive',
        exportedFirst: true,
    });
    expect(cancelled).toMatchObject({ success: true });
    if (!cancelled.success) return;
    expect(cancelled.data.dataRetained).toBe(true);
    expect(cancelled.data.accessUntil).not.toBeNull();

    // Still inside the paid period: cancelling is not confiscation.
    expect((await getSubscriptionState(journey.userId)).tier).toBe(Tier.always_on);

    // Period end. Stripe says the subscription is over.
    const ended = journey.m.stripe.seedSubscription({
        id: careerSubscriptionId,
        customer: (await getSubscriptionState(journey.userId)).career?.stripeCustomerId ?? 'cus_j4',
        priceId: PRICE_IDS.STRIPE_PRICE_CAREER_MONTHLY,
        status: 'canceled',
        currentPeriodEnd: PERIOD_END_SECONDS,
        metadata: { userId: journey.userId },
    });
    expect(await postWebhook('customer.subscription.deleted', ended)).toEqual({
        status: 200,
        body: { received: true },
    });
    expect((await getSubscriptionState(journey.userId)).tier).toBe(Tier.free);

    // ── the assertion this journey exists for: by id, not by count.
    const [survivingWins, survivingEvidence, survivingLinks, survivingMetrics, packet] =
        await Promise.all([
            prisma.win.findMany({ where: { id: { in: seeded.winIds } }, select: { id: true, status: true } }),
            prisma.evidence.findMany({ where: { id: { in: seeded.evidenceIds } }, select: { id: true, confirmedByUser: true } }),
            prisma.claimLink.findMany({ where: { id: { in: seeded.claimLinkIds } }, select: { id: true, groundState: true } }),
            prisma.impactMetric.findMany({ where: { id: { in: seeded.impactMetricIds } }, select: { id: true } }),
            prisma.reviewPacket.findUnique({ where: { id: seeded.packetId }, select: { id: true } }),
        ]);

    expect(survivingWins.map((row) => row.id).sort()).toEqual([...seeded.winIds].sort());
    expect(survivingWins.every((row) => row.status === WinStatus.confirmed)).toBe(true);
    expect(survivingEvidence.map((row) => row.id).sort()).toEqual([...seeded.evidenceIds].sort());
    expect(survivingEvidence.every((row) => row.confirmedByUser)).toBe(true);
    expect(survivingLinks.map((row) => row.id).sort()).toEqual([...seeded.claimLinkIds].sort());
    expect(survivingLinks.every((row) => row.groundState === GroundState.grounded)).toBe(true);
    expect(survivingMetrics.map((row) => row.id).sort()).toEqual([...seeded.impactMetricIds].sort());
    expect(packet?.id).toBe(seeded.packetId);
    for (const winId of seeded.winIds) await assertGrounded(winId);

    // Interview transcripts and their sessions survive the downgrade too.
    expect(await prisma.interviewSession.count({ where: { userId: journey.userId } })).toBe(2);
});

test('free-tier history is hidden, never removed', async () => {
    const visible = await wins.listWins({});
    expect(visible).toMatchObject({ success: true });
    if (!visible.success) return;

    // The two-year-old Win is past Free's 90-day window.
    expect(visible.data.items.map((item) => item.id)).not.toContain(seeded.oldWinId);
    expect(visible.data.hiddenByPlan).toBeGreaterThanOrEqual(1);

    // Hidden. The row is exactly where it was.
    const stored = await prisma.win.findUnique({
        where: { id: seeded.oldWinId },
        select: { id: true, status: true },
    });
    expect(stored).toMatchObject({ id: seeded.oldWinId, status: WinStatus.confirmed });

    const everything = await wins.listWins({ includeBeyondHistoryLimit: true });
    expect(everything).toMatchObject({ success: true });
    if (!everything.success) return;
    expect(everything.data.items.map((item) => item.id)).toContain(seeded.oldWinId);

    // And it is still in the export, which is what "you can always take it with
    // you" has to mean on the Free plan.
    const exported = await billing.exportEverything();
    if (!exported.success) return;
    expect(exported.data.json).toContain(seeded.oldWinId);
});

// ══════════════════════════════════════════ 8. never a raw enum in the copy

test('no raw Tier enum value reached a user-facing string', async () => {
    expect(userFacing.length).toBeGreaterThan(10);

    const enumValues = Object.values(Tier);
    for (const { where, text } of userFacing) {
        for (const value of enumValues) {
            // Case-sensitive and word-bounded: "Free" is the catalog name,
            // `free` is the column value, and only one of them belongs in copy.
            const raw = new RegExp(`\\b${value}\\b`);
            if (raw.test(text)) {
                throw new Error(`raw Tier value "${value}" rendered in ${where}: ${JSON.stringify(text)}`);
            }
        }
    }

    // The positive half: the names that DID appear all came from the catalog.
    const catalogNames = Object.values(PLAN_CATALOG).map((plan) => plan.name);
    const joined = userFacing.map((entry) => entry.text).join(' | ');
    expect(joined).toContain(planName(Tier.free));
    expect(joined).toContain(planName(Tier.always_on));
    expect(joined).toContain(planName(Tier.pro));
    expect(catalogNames).toContain(planName(Tier.pro));
});

// ═══════════════════════════════════════════════════════════════ teardown

test('the journey leaves no dead jobs and nothing behind', async () => {
    await assertNoDeadJobs(journey.runId);
    await purge(journey.runId);
    expect(await assertPurged(journey.runId)).toEqual({});
});
