/**
 * Paywall surfaces PW1–PW7.
 *
 * Two things are graded here. First, the copy: it must name the plan and the
 * price, and it must never use the patterns PRD 06 §4 bans. Second, and more
 * importantly, the **own-data rule** — a paywall may only appear to someone who
 * has data of their own for it to talk about. That is enforced structurally
 * (`hasOwnData`, and loaders returning `null`), and both halves are tested.
 *
 * The loader tests run against the live Postgres; `.env.test` pins it local.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { CaptureSourceKind, WinCategory, WinSource, WinStatus } from '@prisma/client';

import { gateMeteredAction, subscriptionRowKey } from '@/lib/entitlements';
import { CAREER_PLAN, SEARCH_PLAN } from '@/lib/plans';
import { prisma } from '@/lib/prisma';

import {
  pw1GapsAnalysis,
  pw2HiddenHistory,
  pw3TailoredExhausted,
  pw4MarketSignal,
  pw5MissionNeedsSearch,
  pw6ReviewNudge,
  pw7SourceLimit,
  type PaywallContent,
} from './copy';
import { loadPw1, loadPw2, loadPw3, loadPw7 } from './data';

const RUN = `itest-pw-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function newUser(label: string): string {
  const id = `${RUN}-${label}`;
  users.push(id);
  return id;
}

afterEach(async () => {
  while (users.length > 0) {
    const userId = users.pop();
    if (!userId) continue;
    await prisma.win.deleteMany({ where: { userId } });
    await prisma.reviewPacket.deleteMany({ where: { userId } });
    await prisma.captureSource.deleteMany({ where: { userId } });
    await prisma.usageQuota.deleteMany({ where: { userId } });
    await prisma.funnelEvent.deleteMany({ where: { userId } });
    await prisma.subscription.deleteMany({
      where: { userId: { in: [userId, subscriptionRowKey(userId, 'search')] } },
    });
  }
});

const ALL: PaywallContent[] = [
  pw1GapsAnalysis({ winCount: 47, targetLevel: 'Staff' }),
  pw2HiddenHistory({ hiddenWinCount: 41 }),
  pw3TailoredExhausted({ limit: 3, used: 3 }),
  pw4MarketSignal({ bandDeltaPercent: 12, bandSampleSize: 38 }),
  pw5MissionNeedsSearch({ missionName: 'Land a new role' }),
  pw6ReviewNudge({ monthsToReview: 3, gap: 'cross-team influence' }),
  pw7SourceLimit({ connectedSources: 1, careerSourceLimit: 3 }),
];

// ---------------------------------------------------------------------------

describe('copy — the three things that make a paywall convert', () => {
  test('PW1 is the spec copy, with their numbers in it', () => {
    const content = pw1GapsAnalysis({ winCount: 47, targetLevel: 'Staff' });
    expect(content.headline).toBe('You have 47 wins and no gaps analysis.');
    expect(content.body).toContain("what's missing for Staff");
    expect(content.body).toContain('Career, $99/year');
  });

  test('PW2 says saved and hidden — never deleted', () => {
    const content = pw2HiddenHistory({ hiddenWinCount: 41 });
    expect(content.headline).toBe('+41 older wins are saved but hidden.');
    for (const word of ['delete', 'deleted', 'lose', 'lost', 'erase', 'removed']) {
      expect(content.headline.toLowerCase()).not.toContain(word);
      expect(content.body.toLowerCase()).not.toContain(word);
    }
  });

  test('PW3 keeps the v2 copy', () => {
    const content = pw3TailoredExhausted({ limit: 3, used: 3 });
    expect(content.headline).toBe("You've used your 3 free tailored resumes.");
    expect(content.body).toContain('The next role you actually care about');
  });

  test('PW4 offers Search by the month and says it turns off', () => {
    const content = pw4MarketSignal({ bandDeltaPercent: 12, bandSampleSize: 38 });
    expect(content.headline).toContain('+12%');
    // Band `n` is shown. A band without its sample size is a number to distrust.
    expect(content.headline).toContain('38');
    expect(content.body).toContain('$29');
    expect(content.body).toContain('off whenever you stop');
    expect(content.targetTier).toBe(SEARCH_PLAN.tier);
  });

  test('PW5 sells the add-on, cancellable', () => {
    const content = pw5MissionNeedsSearch({ missionName: 'Land a new role' });
    expect(content.body).toContain('Add Search');
    expect(content.body).toContain('cancel any time');
  });

  test('PW6 leads with the named gap', () => {
    const content = pw6ReviewNudge({ monthsToReview: 3, gap: 'cross-team influence' });
    expect(content.headline).toBe('Your review is 3 months out.');
    expect(content.body).toContain('cross-team influence');
  });

  test('PW7 states the source limit as a capability, not a punishment', () => {
    const content = pw7SourceLimit({ connectedSources: 1, careerSourceLimit: 3 });
    expect(content.body).toContain('Career connects up to 3 sources');
  });

  test('every in-app surface names a plan and a price', () => {
    // PW6 is the T-90 email. It sells nothing: it names one gap and links to
    // PW1, which is where the price belongs (PRD 06 §4).
    for (const content of ALL.filter((c) => c.code !== 'PW6')) {
      const text = `${content.headline} ${content.body}`;
      expect(/Career|Search/.test(text)).toBe(true);
      expect(/\$\d/.test(text)).toBe(true);
      expect(content.ctaLabel.length).toBeGreaterThan(0);
    }
  });

  test('PW6 stays a nudge — no price, no pitch, one CTA', () => {
    const content = pw6ReviewNudge({ monthsToReview: 3, gap: 'cross-team influence' });
    expect(`${content.headline} ${content.body}`).not.toContain('$');
    expect(content.ctaLabel).toBe('See it');
  });

  test('no countdown, no scarcity, no urgency theatre', () => {
    const banned = [
      'limited time',
      'limited offer',
      'hurry',
      'act now',
      'expires',
      'ends soon',
      'only ',
      'last chance',
      'don’t miss',
      'spots left',
      '!',
    ];
    for (const content of ALL) {
      const text = `${content.headline} ${content.body} ${content.ctaLabel}`.toLowerCase();
      for (const phrase of banned) {
        expect(text).not.toContain(phrase);
      }
    }
  });
});

describe('the own-data rule', () => {
  test('a user with nothing of their own gets no paywall', () => {
    expect(pw1GapsAnalysis({ winCount: 0, targetLevel: 'Staff' }).hasOwnData).toBe(false);
    expect(pw2HiddenHistory({ hiddenWinCount: 0 }).hasOwnData).toBe(false);
    expect(pw3TailoredExhausted({ limit: 3, used: 0 }).hasOwnData).toBe(false);
    expect(pw4MarketSignal({}).hasOwnData).toBe(false);
    expect(pw6ReviewNudge({ monthsToReview: 3, gap: null }).hasOwnData).toBe(false);
    expect(pw7SourceLimit({ connectedSources: 0, careerSourceLimit: 3 }).hasOwnData).toBe(false);
  });

  test('PW1 still works without a target level — it just stops naming one', () => {
    const content = pw1GapsAnalysis({ winCount: 12, targetLevel: null });
    expect(content.hasOwnData).toBe(true);
    expect(content.body).toContain('your next level');
  });
});

// ---------------------------------------------------------------------------

async function addWin(userId: string, occurredAt: Date) {
  await prisma.win.create({
    data: {
      userId,
      title: `Shipped something on ${occurredAt.toISOString().slice(0, 10)}`,
      occurredAt,
      category: WinCategory.shipped,
      status: WinStatus.confirmed,
      source: WinSource.manual,
    },
  });
}

describe('loaders — real data or nothing', () => {
  test('PW1 is silent for an empty log and speaks once there are wins', async () => {
    const userId = newUser('pw1');
    expect(await loadPw1(userId)).toBeNull();

    await addWin(userId, new Date());
    await addWin(userId, new Date());
    const content = await loadPw1(userId);
    expect(content?.headline).toBe('You have 2 wins and no gaps analysis.');
  });

  test('PW1 uses the level from their own most recent packet', async () => {
    const userId = newUser('pw1-level');
    await addWin(userId, new Date());
    await prisma.reviewPacket.create({
      data: {
        userId,
        type: 'promotion_case',
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-06-30T00:00:00Z'),
        targetLevel: 'Staff',
      },
    });
    const content = await loadPw1(userId);
    expect(content?.body).toContain('Staff');
  });

  test('PW1 never shows to someone who already has the analysis', async () => {
    const userId = newUser('pw1-career');
    await addWin(userId, new Date());
    await prisma.subscription.create({
      data: {
        userId,
        stripeCustomerId: `cus_${RUN}`,
        tier: CAREER_PLAN.tier,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await loadPw1(userId)).toBeNull();
  });

  test('PW2 counts what the plan is hiding, and only that', async () => {
    const userId = newUser('pw2');
    await addWin(userId, new Date());
    expect(await loadPw2(userId)).toBeNull();

    await addWin(userId, new Date(Date.now() - 200 * 86_400_000));
    await addWin(userId, new Date(Date.now() - 400 * 86_400_000));
    const content = await loadPw2(userId);
    expect(content?.headline).toBe('+2 older wins are saved but hidden.');
  });

  test('PW2 is silent on a plan with unlimited history', async () => {
    const userId = newUser('pw2-career');
    await prisma.subscription.create({
      data: {
        userId,
        stripeCustomerId: `cus_${RUN}`,
        tier: CAREER_PLAN.tier,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    await addWin(userId, new Date(Date.now() - 400 * 86_400_000));
    expect(await loadPw2(userId)).toBeNull();
  });

  test('PW3 appears only once the free allotment is actually gone', async () => {
    const userId = newUser('pw3');
    expect(await loadPw3(userId)).toBeNull();

    for (let i = 0; i < 3; i += 1) await gateMeteredAction(userId, 'tailored_generation');
    const content = await loadPw3(userId);
    expect(content?.headline).toBe("You've used your 3 free tailored resumes.");
  });

  test('PW7 appears at the source limit, with their count in it', async () => {
    const userId = newUser('pw7');
    expect(await loadPw7(userId)).toBeNull();

    await prisma.captureSource.create({
      data: {
        userId,
        kind: CaptureSourceKind.github,
        externalAccountId: 'gh-123',
        consentGrantedAt: new Date(),
        consentCopyVersion: 'v1',
      },
    });
    const content = await loadPw7(userId);
    expect(content?.headline).toBe("You've connected 1 of 1 source.");
    expect(content?.body).toContain('up to 3 sources');
  });
});
