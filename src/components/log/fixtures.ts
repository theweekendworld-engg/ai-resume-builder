/**
 * Fixture factory for the Log surface.
 *
 * B2 builds against these, not against live data: `src/actions/wins.ts` is
 * being implemented in parallel and may not exist yet. Everything here is
 * typed by the orchestrator-owned contract in `src/actions/wins.types.ts`, so
 * the swap to the real actions is a type-check rather than a rewrite. See
 * `data-source.ts` for the single seam.
 *
 * Two properties are load-bearing:
 *
 * 1. **Deterministic.** A seeded PRNG, a fixed "now", and UTC-only date
 *    construction. The server render and the client hydration must produce
 *    byte-identical output, and a fixture that reshuffles per machine makes
 *    every visual review a diff against noise.
 * 2. **Realistic.** Three-plus years, all eight categories, drafts alongside
 *    confirmed, wins with and without an employer, with and without an
 *    `ImpactMetric`, and confidential / internal-only examples. The log's
 *    hardest layout problems only appear at that spread.
 */

import type {
  BulkResult,
  CategoryCount,
  CreateWinInput,
  DismissReason,
  EmployerOption,
  EvidenceView,
  ImpactView,
  LogSummary,
  StructuredDraft,
  WinCursor,
  WinFilters,
  WinPage,
  WinPatch,
  WinView,
} from '@/actions/wins.types';
import type { Result } from '@/lib/result';

type Category = WinView['category'];
type Status = WinView['status'];
type Sensitivity = WinView['sensitivity'];
type SourceKind = WinView['source'];
type EvidenceKind = EvidenceView['kind'];

/**
 * The fixture clock. Fixed so that "Jul 14" stays "Jul 14" on every machine
 * and in every screenshot.
 */
export const FIXTURE_NOW = new Date('2026-08-01T00:00:00.000Z');

/** How many Wins the fixture record holds. */
const TOTAL_WINS = 84;
/** Wins inside the plan's history window. The rest render the locked boundary. */
const WINS_IN_PLAN_WINDOW = 43;
/**
 * Which Wins arrive as drafts.
 *
 * Interleaved through the recent stretch rather than taken off the top: a real
 * record has confirmed Wins in the last few weeks *and* a handful of new
 * drafts waiting. Stacking every draft at the front would break the streak,
 * which is exactly the signal the rail is there to show.
 */
const DRAFT_INDICES = new Set([0, 2, 4, 6, 9, 12, 15]);
/** Wins in the recent dense stretch, spaced in days rather than fortnights. */
const RECENT_RUN = 20;
/** Default page size for `listWins`. */
export const FIXTURE_PAGE_SIZE = 25;

const DAY_MS = 86_400_000;

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------- */
/* Content pool                                                                */
/* -------------------------------------------------------------------------- */

interface EvidenceSeed {
  kind: EvidenceKind;
  excerpt: string;
  url?: string;
  confirmed?: boolean;
}

interface Template {
  category: Category;
  /**
   * `{svc}` is replaced with a system name and `{n1}`/`{n2}`/`{pct}` with
   * per-instance figures, so 84 Wins do not read as 16 photocopies. Five Wins
   * all claiming the same 800ms→180ms is the tell that makes a fixture look
   * like a fixture.
   */
  title: string;
  narrative: string;
  skills: string[];
  /** Present on templates that carry a real quantity. */
  impact?: Omit<ImpactView, 'id'>;
  /** The <=8 word question shown when the Win has no `ImpactMetric`. */
  quantify: string;
  evidence: EvidenceSeed[];
  collaborators?: string[];
  /** Draws this instance's figures. Must consume the PRNG deterministically. */
  vary?: (random: () => number) => Record<string, string>;
}

const ALL_CATEGORIES: Category[] = [
  'shipped',
  'improved',
  'fixed',
  'led',
  'influenced',
  'grew',
  'learned',
  'saved',
];

function pick(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

const SERVICES = [
  'checkout',
  'billing',
  'search',
  'onboarding',
  'notifications',
  'ingest',
  'reporting',
  'auth',
  'webhooks',
  'scheduler',
];

const REPOS = ['patronus/api', 'patronus/web', 'patronus/platform', 'patronus/jobs'];

/** Fallback chip label when a source has no parseable identifier. */
const EVIDENCE_KIND_LABEL: Record<EvidenceView['kind'], string> = {
  repo: 'Repository',
  metric_confirmed: 'You confirmed this',
  document: 'Document',
  url: 'Link',
  interview_assertion: 'You said this',
  import: 'Imported',
};

const TEMPLATES: Template[] = [
  {
    category: 'shipped',
    title: 'Shipped the self-serve {svc} upgrade flow',
    narrative:
      'Designed and built the end-to-end flow, from plan picker through to the confirmation email, behind a staged rollout that started at 5% of accounts.',
    skills: ['react', 'stripe', 'next'],
    impact: {
      metric: 'new MRR',
      baseline: '$0',
      result: '${n1}k',
      delta: '+${n1}k',
      scope: 'first 60 days',
      timeframe: '60 days',
    },
    vary: (random) => ({ n1: String(pick(random, 9, 62)) }),
    quantify: 'How many accounts upgraded?',
    evidence: [
      {
        kind: 'repo',
        excerpt:
          'Adds the plan picker, proration preview and the confirmation email. Rolled out behind seat-upgrade-v2 at 5%.',
        url: 'https://github.com/patronus/web/pull/1184',
        confirmed: true,
      },
      {
        kind: 'url',
        excerpt: 'Revenue board, self-serve segment.',
        url: 'https://example.com/grafana/self-serve',
      },
    ],
  },
  {
    category: 'shipped',
    title: 'Launched {svc} v2 to every customer on the platform',
    narrative:
      'Cut the rollout over in four waves with a kill switch at each one. No wave needed a rollback, and the legacy path was deleted the week after.',
    skills: ['release-engineering', 'feature-flags'],
    quantify: 'How many customers migrated?',
    evidence: [
      {
        kind: 'document',
        excerpt: 'Rollout plan: four waves, kill switch per wave, legacy path deleted in wave five.',
        url: 'https://example.com/docs/rollout-v2.md',
        confirmed: true,
      },
    ],
  },
  {
    category: 'improved',
    title: 'Cut {svc} p95 latency {n1}ms → {n2}ms',
    narrative:
      'Rewrote the pricing lookup as a batched query with a read-through cache. Timeouts during peak dropped to near zero and the on-call page for this path stopped firing.',
    skills: ['performance', 'postgres', 'observability'],
    impact: {
      metric: 'p95 latency',
      baseline: '{n1}ms',
      result: '{n2}ms',
      delta: '-{pct}%',
      scope: 'production, all regions',
      timeframe: 'three days of traffic',
    },
    vary: (random) => {
      const before = pick(random, 46, 92) * 10;
      const after = pick(random, 11, 28) * 10;
      return {
        n1: String(before),
        n2: String(after),
        pct: String(Math.round((1 - after / before) * 100)),
      };
    },
    quantify: 'How much faster?',
    evidence: [
      {
        kind: 'repo',
        excerpt:
          'Replaced the N+1 in the hot path with a single joined query and a covering index. p95 fell from {n1}ms to {n2}ms across three days of production traffic.',
        url: 'https://github.com/patronus/api/pull/482',
        confirmed: true,
      },
      {
        kind: 'document',
        excerpt: 'Latency was the top complaint in Q2 support tickets (41 of 190).',
        url: 'https://example.com/docs/q2-retro.md',
      },
    ],
  },
  {
    category: 'improved',
    title: 'Halved the {svc} build time for the whole team',
    narrative:
      'Split the monolithic job into a cached dependency stage and a parallel test matrix. Everyone gets their CI result before they have finished writing the PR description.',
    skills: ['ci', 'caching', 'developer-experience'],
    impact: {
      metric: 'CI wall time',
      baseline: '{n1}m',
      result: '{n2}m',
      delta: '-{pct}%',
      scope: 'every PR',
      timeframe: null,
    },
    vary: (random) => {
      const before = pick(random, 14, 26);
      const after = pick(random, 5, 11);
      return {
        n1: String(before),
        n2: String(after),
        pct: String(Math.round((1 - after / before) * 100)),
      };
    },
    quantify: 'How many minutes saved per run?',
    evidence: [
      {
        kind: 'repo',
        excerpt: 'Split into a cached deps stage plus a 6-way test matrix.',
        url: 'https://github.com/patronus/platform/pull/903',
      },
    ],
  },
  {
    category: 'fixed',
    title: 'Fixed the duplicate {svc} bug that double-charged {n1} accounts',
    narrative:
      'Traced it to a retry that reused the idempotency key after a partial write. Added the key to the unique constraint, backfilled refunds, and wrote the regression test first.',
    skills: ['idempotency', 'stripe', 'incident-response'],
    impact: {
      metric: 'accounts affected',
      baseline: '{n1}',
      result: '0',
      delta: '{n1} refunded',
      scope: null,
      timeframe: null,
    },
    vary: (random) => ({ n1: String(pick(random, 9, 84)) }),
    quantify: 'How many customers were affected?',
    evidence: [
      {
        kind: 'metric_confirmed',
        excerpt: 'Confirmed by you: {n1} accounts refunded, no recurrence in 90 days.',
        confirmed: true,
      },
    ],
  },
  {
    category: 'fixed',
    title: 'Stopped the {svc} queue from silently dropping messages',
    narrative:
      'The consumer acknowledged before the write committed, so a crash lost the message with no trace. Moved the ack after commit and added a dead-letter path with an alert.',
    skills: ['queues', 'reliability'],
    quantify: 'How many messages were being lost?',
    evidence: [
      {
        kind: 'repo',
        excerpt: 'Ack after commit; dead-letter queue with a paging alert on depth > 0.',
        url: 'https://github.com/patronus/jobs/pull/221',
      },
    ],
  },
  {
    category: 'led',
    title: 'Led the {svc} migration off the legacy queue',
    narrative:
      'Ran the design review, split the work across three engineers, and owned the cutover window. Wrote the rollback plan myself and never needed it.',
    skills: ['leadership', 'architecture'],
    quantify: 'How many engineers did you lead?',
    evidence: [
      {
        kind: 'interview_assertion',
        excerpt: 'I led the migration and wrote the rollback plan myself.',
      },
    ],
    collaborators: ['Priya N.', 'Sam O.', 'Dana R.'],
  },
  {
    category: 'led',
    title: 'Ran the {svc} incident review and owned the follow-ups',
    narrative:
      'Facilitated the blameless review with {n2} people in the room, wrote the timeline, and tracked every action item to closed inside a month.',
    skills: ['incident-response', 'facilitation'],
    impact: {
      metric: 'follow-up actions closed',
      baseline: '0 of {n1}',
      result: '{n1} of {n1}',
      delta: '{n1} closed',
      scope: null,
      timeframe: '30 days',
    },
    vary: (random) => ({ n1: String(pick(random, 4, 14)), n2: String(pick(random, 6, 18)) }),
    quantify: 'How many follow-ups did you close?',
    evidence: [
      {
        kind: 'document',
        excerpt: 'Blameless review, {n2} attendees. {n1} action items, all closed by 30 days.',
        url: 'https://example.com/docs/incident-review.md',
        confirmed: true,
      },
    ],
  },
  {
    category: 'influenced',
    title: 'Influenced the {svc} versioning RFC adopted across {n1} teams',
    narrative:
      'Wrote the counter-proposal after the first draft would have broken every existing client. It is now the default in the service template.',
    skills: ['api-design', 'rfc'],
    impact: {
      metric: 'teams adopting',
      baseline: '0',
      result: '{n1}',
      delta: '{n1} teams',
      scope: 'platform org',
      timeframe: null,
    },
    vary: (random) => ({ n1: String(pick(random, 3, 9)) }),
    quantify: 'How many teams adopted it?',
    evidence: [
      {
        kind: 'document',
        excerpt: 'RFC-114: version in the path, deprecation window of two minor releases.',
        url: 'https://example.com/docs/rfc-114.md',
        confirmed: true,
      },
      {
        kind: 'repo',
        excerpt: 'Applies RFC-114 to the service template.',
        url: 'https://github.com/patronus/platform/pull/771',
      },
    ],
  },
  {
    category: 'influenced',
    title: 'Changed how the {svc} team handles retries',
    narrative:
      'Reviewed their design doc and showed that the retry policy would amplify a partial outage into a full one. They rewrote it with jitter and a circuit breaker.',
    skills: ['distributed-systems', 'code-review'],
    quantify: 'How many teams changed course?',
    evidence: [
      {
        kind: 'interview_assertion',
        excerpt: 'They rewrote the retry policy after my review comment on the design doc.',
      },
    ],
  },
  {
    category: 'grew',
    title: 'Grew the {svc} guild from {n1} engineers to {n2}',
    narrative:
      'Started a fortnightly forum with a written agenda and a rotating owner. It outlived my involvement, which is the part I am proudest of.',
    skills: ['mentoring', 'community'],
    impact: {
      metric: 'active members',
      baseline: '{n1}',
      result: '{n2}',
      delta: '{n1} → {n2}',
      scope: null,
      timeframe: 'six months',
    },
    vary: (random) => {
      const before = pick(random, 3, 6);
      return { n1: String(before), n2: String(before + pick(random, 4, 11)) };
    },
    quantify: 'How many people joined?',
    evidence: [
      {
        kind: 'document',
        excerpt: 'Guild roster: {n2} active members across 5 teams.',
        url: 'https://example.com/docs/guild-roster.md',
        confirmed: true,
      },
    ],
  },
  {
    category: 'grew',
    title: 'Mentored two engineers onto the {svc} on-call rotation',
    narrative:
      'Paired through six incidents, wrote the runbook gaps they hit, and handed over the pager. Both now run their own reviews.',
    skills: ['mentoring', 'on-call'],
    quantify: 'How many people did you mentor?',
    evidence: [
      {
        kind: 'interview_assertion',
        excerpt: 'Paired through six incidents before handing over the pager.',
      },
    ],
    collaborators: ['Ines K.', 'Tom B.'],
  },
  {
    category: 'learned',
    title: 'Learned enough Rust to review the {svc} rewrite',
    narrative:
      'Worked through the ownership model on a weekend project, then reviewed 4,000 lines of the rewrite and caught two lifetime bugs before they merged.',
    skills: ['rust'],
    quantify: 'What did it let you take on?',
    evidence: [
      {
        kind: 'interview_assertion',
        excerpt: 'Reviewed 4k lines of the rewrite and caught two lifetime bugs.',
      },
    ],
  },
  {
    category: 'learned',
    title: 'Got the {svc} data model deep enough to run the migration alone',
    narrative:
      'Read every migration back to the first commit and mapped the historical shapes. It is now the document the team sends to new joiners.',
    skills: ['postgres', 'documentation'],
    quantify: 'What could you do afterwards?',
    evidence: [
      {
        kind: 'document',
        excerpt: 'Historical schema map, 2019 to today, with the three shape changes annotated.',
        url: 'https://example.com/docs/schema-history.md',
      },
    ],
  },
  {
    category: 'saved',
    title: 'Saved ${n1}k a year by right-sizing the {svc} cluster',
    narrative:
      'Profiled a fortnight of real usage, found we were provisioned for a peak that had not happened since the launch, and dropped two node classes.',
    skills: ['aws', 'cost', 'capacity-planning'],
    impact: {
      metric: 'annual infrastructure spend',
      baseline: '${n2}k/yr',
      result: '${n3}k/yr',
      delta: '-${n1}k/yr',
      scope: 'staging and preview',
      timeframe: 'annualised',
    },
    vary: (random) => {
      const saved = pick(random, 7, 44);
      const before = saved + pick(random, 18, 60);
      return { n1: String(saved), n2: String(before), n3: String(before - saved) };
    },
    quantify: 'How much did it save?',
    evidence: [
      {
        kind: 'url',
        excerpt: 'Cost explorer, month over month after the change.',
        url: 'https://example.com/cost/staging',
        confirmed: true,
      },
    ],
  },
  {
    category: 'saved',
    title: 'Removed the vendor from the {svc} path and cancelled the contract',
    narrative:
      'Replaced it with 300 lines and a cron. The renewal was due the following quarter and we did not sign it.',
    skills: ['cost', 'vendor-management'],
    quantify: 'How much was the contract worth?',
    evidence: [
      {
        kind: 'import',
        excerpt: 'Imported from the 2025 resume you uploaded during onboarding.',
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Employers                                                                   */
/* -------------------------------------------------------------------------- */

interface EmployerWindow {
  id: string;
  name: string;
  /** Inclusive start; the window runs until the next entry begins. */
  from: Date;
}

/**
 * Reverse-chronological. The oldest entry is open-ended at the bottom so every
 * date resolves to something.
 */
const EMPLOYERS: EmployerWindow[] = [
  { id: 'exp-acme', name: 'Acme', from: new Date('2024-05-01T00:00:00.000Z') },
  { id: 'exp-lumen', name: 'Lumen Health', from: new Date('2023-04-01T00:00:00.000Z') },
  { id: 'exp-northwind', name: 'Northwind Logistics', from: new Date('2000-01-01T00:00:00.000Z') },
];

function employerAt(date: Date): EmployerWindow {
  return EMPLOYERS.find((entry) => date >= entry.from) ?? EMPLOYERS[EMPLOYERS.length - 1];
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                  */
/* -------------------------------------------------------------------------- */

const SOURCE_CYCLE: SourceKind[] = ['github', 'github', 'github', 'manual', 'calendar', 'github', 'backfill'];

function groundStateFor(evidence: EvidenceView[], impact: ImpactView | null): WinView['groundState'] {
  if (evidence.some((item) => item.confirmedByUser)) return 'grounded';
  if (evidence.length > 0) return 'needs_confirmation';
  // A number with nothing behind it is the case the truthfulness pass exists
  // for: it must not be printed.
  return impact ? 'unsupported' : 'needs_confirmation';
}

function buildWins(): WinView[] {
  const random = mulberry32(0x9e3779b9);
  const wins: WinView[] = [];

  let cursorMs = Date.UTC(2026, 6, 28);

  for (let index = 0; index < TOTAL_WINS; index += 1) {
    // The most recent stretch is dense, which is what makes a streak real and
    // gives the top months the 6-10 Wins the layout has to survive.
    const gapDays = index < RECENT_RUN ? pick(random, 2, 5) : pick(random, 8, 23);
    if (index > 0) cursorMs -= gapDays * DAY_MS;

    const occurredAt = new Date(cursorMs);
    const template = TEMPLATES[index % TEMPLATES.length];
    const service = SERVICES[(index * 3 + Math.floor(index / TEMPLATES.length)) % SERVICES.length];
    const employer = employerAt(occurredAt);

    const tokens: Record<string, string> = { svc: service, ...(template.vary?.(random) ?? {}) };
    const fill = (text: string) => text.replace(/\{(\w+)\}/g, (match, key: string) => tokens[key] ?? match);

    const status: Status = DRAFT_INDICES.has(index)
      ? 'draft'
      : index % 29 === 17
        ? 'archived'
        : 'confirmed';

    const sensitivity: Sensitivity =
      index % 13 === 3 ? 'confidential' : index % 5 === 2 ? 'internal_only' : 'shareable';

    // Attribution is genuinely unknown for a slice of any real record.
    const unattributed = index % 17 === 9;

    const keepImpact = Boolean(template.impact) && index % 5 !== 4;
    const templateImpact = template.impact;
    const impact: ImpactView | null =
      keepImpact && templateImpact
        ? {
            id: `imp-${index}`,
            metric: fill(templateImpact.metric),
            baseline: templateImpact.baseline ? fill(templateImpact.baseline) : null,
            result: templateImpact.result ? fill(templateImpact.result) : null,
            delta: templateImpact.delta ? fill(templateImpact.delta) : null,
            scope: templateImpact.scope,
            timeframe: templateImpact.timeframe,
          }
        : null;

    const evidenceSeeds = index % 7 === 6 ? [] : template.evidence;
    const evidence: EvidenceView[] = evidenceSeeds.map((seed, seedIndex) => {
      const repo = REPOS[index % REPOS.length];
      const url = seed.url ? seed.url.replace('patronus/api', repo) : null;
      const prNumber = url?.match(/\/pull\/(\d+)/)?.[1] ?? null;
      return {
        id: `ev-${index}-${seedIndex}`,
        kind: seed.kind,
        excerpt: fill(seed.excerpt),
        // Server-derived in the real implementation; mirrored here so the
        // fixture exercises the same rendering path SourceChip will take.
        label: prNumber ? `PR #${prNumber}` : EVIDENCE_KIND_LABEL[seed.kind],
        detail: url ? repo : null,
        url,
        // One seeded dead source so the strikethrough treatment is reachable.
        available: !(index % 11 === 10 && seedIndex === 0),
        // A draft has not been through a human yet, so nothing on it is confirmed.
        confirmedByUser: status === 'draft' ? false : Boolean(seed.confirmed),
      };
    });

    const confirmedAt =
      status === 'confirmed' || status === 'archived'
        ? new Date(cursorMs + (2 + Math.floor(random() * 5)) * DAY_MS)
        : null;

    wins.push({
      id: `win-${String(index + 1).padStart(3, '0')}`,
      title: fill(template.title),
      narrative: fill(template.narrative),
      occurredAt,
      periodEnd: null,
      category: template.category,
      status,
      sensitivity,
      source: SOURCE_CYCLE[index % SOURCE_CYCLE.length],
      sourceRef: evidence[0]?.url ?? null,
      employerId: unattributed ? null : employer.id,
      employerName: unattributed ? null : employer.name,
      projectId: null,
      skills: template.skills,
      collaborators: template.collaborators ?? [],
      confidence: Math.round((0.55 + random() * 0.42) * 100) / 100,
      confirmedAt,
      createdAt: new Date(cursorMs + DAY_MS),
      impact,
      evidence,
      groundState: groundStateFor(evidence, impact),
      quantifyPrompt: impact ? null : template.quantify,
    });
  }

  return wins;
}

/* -------------------------------------------------------------------------- */
/* In-memory store                                                             */
/* -------------------------------------------------------------------------- */

let store: WinView[] | null = null;

function wins(): WinView[] {
  if (!store) store = buildWins();
  return store;
}

function byRecency(a: WinView, b: WinView): number {
  const diff = b.occurredAt.getTime() - a.occurredAt.getTime();
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
}

/**
 * The plan's history boundary.
 *
 * The real Free rule is a rolling 90 days (`WinFilters.includeBeyondHistoryLimit`).
 * The fixture uses a wider window on purpose: at 90 days there are only two
 * month groups, and the sticky-header behaviour this screen exists to get right
 * never appears. The server owns the real cutoff.
 */
function planCutoff(): Date {
  const sorted = [...wins()].sort(byRecency);
  const edge = sorted[Math.min(WINS_IN_PLAN_WINDOW, sorted.length) - 1];
  return edge ? edge.occurredAt : new Date(0);
}

function matches(win: WinView, filters: WinFilters): boolean {
  if (filters.status && filters.status.length > 0 && !filters.status.includes(win.status)) {
    return false;
  }
  if (filters.category && filters.category.length > 0 && !filters.category.includes(win.category)) {
    return false;
  }
  if (filters.employerId !== undefined && win.employerId !== filters.employerId) return false;
  if (filters.from && win.occurredAt < filters.from) return false;
  if (filters.to && win.occurredAt > filters.to) return false;
  if (filters.search) {
    const needle = filters.search.trim().toLowerCase();
    if (needle) {
      const haystack = `${win.title} ${win.narrative}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

function encodeCursor(win: WinView): WinCursor {
  return `${win.occurredAt.toISOString()}~${win.id}`;
}

function ok<T>(data: T): Result<T> {
  return { success: true, data };
}

function fail<T = never>(error: string, code?: string): Result<T> {
  return { success: false, error, code };
}

function find(winId: string): WinView | undefined {
  return wins().find((win) => win.id === winId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Contract implementations                                                    */
/* -------------------------------------------------------------------------- */

export async function listWins(
  filters: WinFilters,
  cursor?: WinCursor,
  limit: number = FIXTURE_PAGE_SIZE,
): Promise<Result<WinPage>> {
  const sorted = [...wins()].sort(byRecency);
  const cutoff = planCutoff();
  const beyondLimit = filters.includeBeyondHistoryLimit === true;

  const inWindow = beyondLimit ? sorted : sorted.filter((win) => win.occurredAt >= cutoff);
  const outOfWindow = beyondLimit ? [] : sorted.filter((win) => win.occurredAt < cutoff);

  const matching = inWindow.filter((win) => matches(win, filters));
  const start = cursor ? matching.findIndex((win) => encodeCursor(win) === cursor) + 1 : 0;
  const items = matching.slice(start, start + limit);
  const last = items[items.length - 1];

  return ok({
    items,
    nextCursor: last && start + limit < matching.length ? encodeCursor(last) : null,
    total: matching.length,
    hiddenByPlan: outOfWindow.filter((win) => matches(win, filters)).length,
  });
}

export async function getLogSummary(range?: { from?: Date; to?: Date }): Promise<Result<LogSummary>> {
  const inRange = wins().filter((win) => {
    if (range?.from && win.occurredAt < range.from) return false;
    if (range?.to && win.occurredAt > range.to) return false;
    return true;
  });

  const confirmed = inRange.filter((win) => win.status === 'confirmed');

  const counts = new Map<Category, number>();
  for (const win of confirmed) {
    counts.set(win.category, (counts.get(win.category) ?? 0) + 1);
  }
  const categoryMix: CategoryCount[] = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // "This quarter" is the window the rail's coaching line talks about.
  //
  // Absent beats thin, and the list is capped at three: flagging five of eight
  // categories turns the rail into a wall of amber and stops meaning anything.
  const quarterStart = new Date(FIXTURE_NOW.getTime() - 90 * DAY_MS);
  const quarterCounts = new Map<Category, number>();
  for (const win of confirmed) {
    if (win.occurredAt >= quarterStart) {
      quarterCounts.set(win.category, (quarterCounts.get(win.category) ?? 0) + 1);
    }
  }
  const absent = ALL_CATEGORIES.filter((category) => (quarterCounts.get(category) ?? 0) === 0);
  const thin = ALL_CATEGORIES.filter((category) => (quarterCounts.get(category) ?? 0) === 1);
  const gaps = (absent.length > 0 ? absent : thin).slice(0, 3);

  const recordStart = confirmed.reduce<Date | null>(
    (earliest, win) => (!earliest || win.occurredAt < earliest ? win.occurredAt : earliest),
    null,
  );

  return ok({
    totalConfirmed: confirmed.length,
    withEvidence: confirmed.filter((win) => win.evidence.length > 0).length,
    withImpact: confirmed.filter((win) => win.impact !== null).length,
    draftCount: inRange.filter((win) => win.status === 'draft').length,
    streakWeeks: streakWeeks(confirmed),
    categoryMix,
    gaps,
    recordStart,
  });
}

/**
 * Consecutive weeks, counting back from the fixture clock, with a confirmed
 * Win in them.
 *
 * The current week is allowed to be empty without breaking the run — it is
 * Tuesday, not a failure. Anything older than that and the streak has ended,
 * at which point `StreakBadge` simply stops rendering rather than showing a
 * zero. Punishing a missed week is how you lose the user who missed a week.
 */
function streakWeeks(confirmed: WinView[]): number {
  const weeks = new Set(confirmed.map((win) => Math.floor(win.occurredAt.getTime() / (7 * DAY_MS))));
  const thisWeek = Math.floor(FIXTURE_NOW.getTime() / (7 * DAY_MS));
  let week = weeks.has(thisWeek) ? thisWeek : thisWeek - 1;
  let count = 0;
  while (weeks.has(week)) {
    count += 1;
    week -= 1;
  }
  return count;
}

export async function confirmWin(winId: string, patch?: WinPatch): Promise<Result<WinView>> {
  await sleep(140);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  Object.assign(win, patch ?? {});
  win.status = 'confirmed';
  win.confirmedAt = win.confirmedAt ?? new Date(FIXTURE_NOW);
  if (win.evidence[0]) win.evidence[0].confirmedByUser = true;
  win.groundState = groundStateFor(win.evidence, win.impact);
  return ok({ ...win });
}

export async function unconfirmWin(winId: string): Promise<Result<WinView>> {
  await sleep(120);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  win.status = 'draft';
  win.confirmedAt = null;
  return ok({ ...win });
}

export async function updateWin(winId: string, patch: WinPatch): Promise<Result<WinView>> {
  await sleep(120);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  Object.assign(win, patch);
  if (patch.employerId !== undefined) {
    win.employerName = EMPLOYERS.find((entry) => entry.id === patch.employerId)?.name ?? null;
  }
  return ok({ ...win });
}

export async function dismissWin(winId: string, reason: DismissReason): Promise<Result<void>> {
  await sleep(120);
  const win = find(winId);
  if (!win) return fail<void>('That win no longer exists.', 'not_found');
  win.status = 'dismissed';
  // The real action records the reason; the fixture only has to prove that a
  // dismissed Win leaves the log.
  void reason;
  return ok(undefined);
}

export async function restoreWin(winId: string): Promise<Result<WinView>> {
  await sleep(80);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  if (win.status === 'dismissed') win.status = 'draft';
  return ok({ ...win });
}

export async function bulkConfirm(winIds: string[]): Promise<Result<BulkResult>> {
  await sleep(220);
  const result: BulkResult = { ok: [], failed: [] };
  for (const winId of winIds) {
    const outcome = await confirmWin(winId);
    if (outcome.success) result.ok.push(winId);
    else result.failed.push({ winId, error: outcome.error });
  }
  return ok(result);
}

export async function createWinFromText(input: CreateWinInput): Promise<Result<WinView>> {
  await sleep(260);
  // `text` is now optional: a caller may submit a user-edited `draft` instead,
  // in which case those fields win and nothing is re-structured.
  const text = (input.text ?? '').trim();
  if (!text && !input.draft) return fail('Write a line about what happened.', 'empty');

  const structured = { ...structureSync(text), ...(input.draft ?? {}) };
  const occurredAt = input.occurredAt ?? new Date(FIXTURE_NOW);
  const employer = employerAt(occurredAt);

  const win: WinView = {
    id: `win-new-${wins().length + 1}`,
    title: structured.title,
    narrative: structured.narrative,
    occurredAt,
    periodEnd: null,
    category: structured.category,
    status: 'confirmed',
    sensitivity: input.sensitivity ?? 'shareable',
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef ?? null,
    employerId: employer.id,
    employerName: employer.name,
    projectId: null,
    skills: [],
    collaborators: [],
    confidence: 1,
    confirmedAt: new Date(FIXTURE_NOW),
    createdAt: new Date(FIXTURE_NOW),
    impact: null,
    evidence: [
      {
        id: `ev-new-${wins().length + 1}`,
        kind: 'interview_assertion',
        excerpt: text,
        label: 'You said this',
        detail: null,
        url: null,
        available: true,
        confirmedByUser: true,
      },
    ],
    groundState: 'grounded',
    quantifyPrompt: structured.quantifyPrompt,
  };

  wins().unshift(win);
  return ok({ ...win });
}

/* -------------------------------------------------------------------------- */
/* Beyond the contract                                                         */
/*                                                                             */
/* Everything below is required by design/02 §C and §D but has no signature in */
/* `wins.types.ts`. Reported in the handoff; implemented here so the surface   */
/* is complete rather than half-wired.                                         */
/* -------------------------------------------------------------------------- */

export interface DraftStructure {
  title: string;
  narrative: string;
  category: Category;
  /** Non-null when the structured draft carries no number. */
  quantifyPrompt: string | null;
}

const CATEGORY_HINTS: Array<[Category, string[]]> = [
  ['fixed', ['fix', 'bug', 'broke', 'outage', 'crash', 'patch']],
  ['improved', ['faster', 'latency', 'reduce', 'improv', 'optimis', 'optimiz', 'cut ', 'speed']],
  ['shipped', ['ship', 'launch', 'release', 'built', 'build']],
  ['led', ['led ', 'lead', 'ran ', 'owned', 'drove']],
  ['influenced', ['review', 'rfc', 'convinced', 'proposal', 'design doc']],
  ['grew', ['mentor', 'hired', 'onboard', 'coach', 'grew']],
  ['saved', ['cost', 'saved', 'budget', 'spend', 'cancel']],
  ['learned', ['learn', 'read', 'course', 'studied']],
];

const NUMBER_PATTERN = /\d/;

function structureSync(text: string): DraftStructure {
  const lower = text.toLowerCase();
  const category = CATEGORY_HINTS.find(([, hints]) => hints.some((hint) => lower.includes(hint)))?.[0] ?? 'shipped';

  const firstClause = text.split(/[.,;\n]/)[0].trim();
  const title = firstClause
    ? firstClause.charAt(0).toUpperCase() + firstClause.slice(1, 96)
    : text.slice(0, 96);

  const narrative = text.length > firstClause.length ? text : `${text}`;

  const quantifyPrompt = NUMBER_PATTERN.test(text)
    ? null
    : category === 'improved'
      ? 'How much faster?'
      : category === 'saved'
        ? 'How much did it save?'
        : category === 'grew'
          ? 'How many people?'
          : 'How big was the impact?';

  return { title, narrative, category, quantifyPrompt };
}

/**
 * The §D structuring pass: raw notes become an editable title, narrative and
 * category *before* anything is written. `CreateWinInput` cannot express the
 * result, which is the gap reported in the handoff.
 */
export async function structureDraft(text: string): Promise<Result<StructuredDraft>> {
  await sleep(900);
  const trimmed = text.trim();
  if (!trimmed) return fail<StructuredDraft>('Write a line about what happened.', 'empty');

  const partial = structureSync(trimmed);
  // Conform to the contract. The fixture never invents a quantity, matching the
  // real drafter: `quantified` stays false and the prompt carries the ask.
  return ok({
    title: partial.title,
    narrative: partial.narrative,
    category: partial.category,
    occurredAt: new Date(FIXTURE_NOW),
    skills: [],
    collaborators: [],
    suggestedSensitivity: 'shareable',
    quantified: partial.quantifyPrompt === null,
    impact: null,
    quantifyPrompt: partial.quantifyPrompt,
    confidence: 0.7,
  });
}

/** Answers the §C quantify prompt. `WinPatch` has no `impact` field. */
export async function addImpact(winId: string, answer: string): Promise<Result<WinView>> {
  await sleep(160);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  const value = answer.trim();
  if (!value) return fail('Enter a number, or skip.', 'empty');
  win.impact = {
    id: `imp-${win.id}`,
    metric: win.quantifyPrompt?.replace(/^How much |^How many |\?$/g, '').trim() || 'impact',
    baseline: null,
    result: value,
    delta: value,
    scope: null,
    timeframe: null,
  };
  win.quantifyPrompt = null;
  win.groundState = groundStateFor(win.evidence, win.impact);
  return ok({ ...win });
}

/** The §C `[ Archive ]` action. No contract signature sets `status`. */
export async function archiveWin(winId: string): Promise<Result<WinView>> {
  await sleep(120);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  win.status = 'archived';
  return ok({ ...win });
}

/** Restores an archived Win. Grounded evidence means it was confirmed before. */
export async function unarchiveWin(winId: string): Promise<Result<WinView>> {
  await sleep(120);
  const win = find(winId);
  if (!win) return fail('That win no longer exists.', 'not_found');
  win.status = win.groundState === 'grounded' ? 'confirmed' : 'draft';
  return ok({ ...win });
}

/** The §C `[ Delete ]` action, and the undo behind the §D capture toast. */
export async function deleteWin(winId: string): Promise<Result<void>> {
  await sleep(120);
  const list = wins();
  const index = list.findIndex((win) => win.id === winId);
  if (index === -1) return fail<void>('That win no longer exists.', 'not_found');
  list.splice(index, 1);
  return ok(undefined);
}

/** Employer options for the filter bar and the drawer's Details block. */
export async function listEmployers(): Promise<Result<EmployerOption[]>> {
  return ok(
    EMPLOYERS.map((employer, index) => ({
      id: employer.id,
      name: employer.name,
      role: 'role' in employer && typeof employer.role === 'string' ? employer.role : 'Engineer',
      current: index === 0,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Samples for the first-run empty state                                       */
/* -------------------------------------------------------------------------- */

/**
 * Three Wins rendered at 45% behind a "Sample" caption, so a first-run user
 * sees what they are building toward. Deliberately not drawn from the store:
 * a first-run user has no store.
 */
export function sampleWins(): WinView[] {
  const base = buildWins();
  return [base[2], base[6], base[10]].map((win, index) => ({
    ...win,
    id: `sample-${index + 1}`,
    status: 'confirmed' as Status,
  }));
}
