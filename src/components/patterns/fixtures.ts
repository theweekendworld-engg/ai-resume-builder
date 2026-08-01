/**
 * Fixture data for `/dev/patterns`.
 *
 * Deliberately static: the pattern gallery must render with no data layer, no
 * API, and no database. Dates are fixed ISO strings so the gallery looks the
 * same on every machine.
 */

import type { ProgressStage } from './progress-stages';
import type { SourceRef, WinRecord } from './types';

export const SOURCES: Record<string, SourceRef> = {
  pr: {
    id: 'src-pr',
    kind: 'repo',
    label: 'PR #482',
    detail: 'patronus/api',
    url: 'https://example.com/pr/482',
    excerpt:
      'Replaced the N+1 in checkout with a single joined query and a covering index. p95 fell from 812ms to 178ms across three days of production traffic.',
  },
  doc: {
    id: 'src-doc',
    kind: 'document',
    label: 'Q3 retro.md',
    excerpt: 'Checkout latency was the top complaint in Q2 support tickets (41 of 190).',
  },
  url: {
    id: 'src-url',
    kind: 'url',
    label: 'Grafana board',
    url: 'https://example.com/grafana',
  },
  interview: {
    id: 'src-interview',
    kind: 'interview_assertion',
    label: 'You said this',
    excerpt: '"I led the migration and wrote the rollback plan myself."',
  },
  metric: {
    id: 'src-metric',
    kind: 'metric_confirmed',
    label: 'Confirmed: −77%',
    excerpt: 'Confirmed by you on 12 Jul 2026.',
  },
  imported: {
    id: 'src-import',
    kind: 'import',
    label: 'resume.pdf',
    excerpt: 'Imported from the 2024 resume you uploaded during onboarding.',
  },
  dead: {
    id: 'src-dead',
    kind: 'url',
    label: 'internal wiki',
    dead: true,
    excerpt: 'Deprecating the legacy queue: owner sign-off recorded 4 Feb.',
  },
};

export const WINS: WinRecord[] = [
  {
    id: 'win-1',
    title: 'Cut checkout p95 latency 800ms → 180ms',
    occurredAt: '2026-07-14T00:00:00.000Z',
    category: 'improved',
    sensitivity: 'shareable',
    ground: 'grounded',
    employer: 'Acme',
    sources: [SOURCES.pr, SOURCES.doc, SOURCES.url],
    metric: { value: '−77%', detail: '812ms → 178ms, p95 over three days' },
    skills: ['performance', 'postgres', 'observability'],
  },
  {
    id: 'win-2',
    title: 'Led the payments migration off the legacy queue',
    occurredAt: '2026-07-09T00:00:00.000Z',
    category: 'led',
    sensitivity: 'internal_only',
    ground: 'needs_confirmation',
    employer: 'Acme',
    sources: [SOURCES.interview, SOURCES.dead],
    metric: null,
    skills: ['leadership', 'payments'],
  },
  {
    id: 'win-3',
    title: 'Shipped the self-serve seat upgrade flow',
    occurredAt: '2026-06-28T00:00:00.000Z',
    category: 'shipped',
    sensitivity: 'confidential',
    ground: 'grounded',
    employer: 'Acme Growth Team',
    sources: [SOURCES.pr],
    metric: { value: '+$41k MRR', detail: 'First 60 days after launch' },
    skills: ['billing', 'stripe', 'react', 'next'],
  },
  {
    id: 'win-4',
    title: 'Fixed the duplicate-webhook bug that double-charged 38 accounts',
    occurredAt: '2026-06-11T00:00:00.000Z',
    category: 'fixed',
    sensitivity: 'shareable',
    ground: 'unsupported',
    employer: 'Acme',
    sources: [SOURCES.metric],
    metric: { value: '38 accounts' },
    skills: ['idempotency', 'stripe'],
  },
  {
    id: 'win-5',
    title: 'Grew the platform guild from four engineers to eleven',
    occurredAt: '2025-11-03T00:00:00.000Z',
    category: 'grew',
    sensitivity: 'shareable',
    ground: 'grounded',
    employer: 'Acme',
    sources: [SOURCES.doc, SOURCES.imported, SOURCES.url, SOURCES.interview],
    metric: { value: '4 → 11' },
    skills: ['mentoring'],
  },
  {
    id: 'win-6',
    title: 'Learned enough Rust to review the ingest rewrite',
    occurredAt: '2026-05-22T00:00:00.000Z',
    category: 'learned',
    sensitivity: 'shareable',
    ground: 'needs_confirmation',
    sources: [SOURCES.interview],
    metric: null,
    skills: ['rust'],
  },
  {
    id: 'win-7',
    title: 'Saved $18k/yr by right-sizing the staging cluster',
    occurredAt: '2026-05-04T00:00:00.000Z',
    category: 'saved',
    sensitivity: 'shareable',
    ground: 'grounded',
    employer: 'Acme',
    sources: [SOURCES.url],
    metric: { value: '−$18k/yr' },
    skills: ['aws', 'cost'],
  },
  {
    id: 'win-8',
    title: 'Influenced the API versioning RFC adopted across four teams',
    occurredAt: '2026-04-19T00:00:00.000Z',
    category: 'influenced',
    sensitivity: 'internal_only',
    ground: 'grounded',
    employer: 'Acme',
    sources: [SOURCES.doc, SOURCES.pr],
    metric: { value: '4 teams' },
    skills: ['api-design', 'rfc'],
  },
];

/** A short queue: the 1–5 item case. */
export const QUEUE_ITEMS: WinRecord[] = WINS.slice(0, 3).map((win, index) => ({
  ...win,
  id: `queue-${index + 1}`,
}));

/** A long queue: exercises the "Show n more" bound. */
export const LONG_QUEUE_ITEMS: WinRecord[] = WINS.map((win, index) => ({
  ...win,
  id: `long-queue-${index + 1}`,
}));

export const PROGRESS_STAGES: ProgressStage[] = [
  { id: 'p1', label: 'Parsing job requirements', status: 'done', result: 'found 14 requirements' },
  { id: 'p2', label: 'Finding relevant projects and experience', status: 'done', result: 'found 5 themes' },
  { id: 'p3', label: 'Rewriting bullets for impact', status: 'active' },
  { id: 'p4', label: 'Validating claims', status: 'pending' },
  { id: 'p5', label: 'Generating export-ready PDF', status: 'pending' },
];

export const PROGRESS_STAGES_ERROR: ProgressStage[] = [
  { id: 'e1', label: 'Parsing job requirements', status: 'done', result: 'found 14 requirements' },
  { id: 'e2', label: 'Finding relevant projects and experience', status: 'error', result: 'Search timed out' },
  { id: 'e3', label: 'Rewriting bullets for impact', status: 'pending' },
];
