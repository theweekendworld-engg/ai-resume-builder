/**
 * `WinView` (the wire contract) → `WinRecord` (what the pattern library
 * renders), plus the grouping and phrasing the Log surface needs.
 *
 * The two shapes are close but not identical on purpose: `WinRecord` is a view
 * model with no Prisma enums and no relations, so `WinCard` can be used from
 * the email renderer and the extension. This module is the only place that
 * knows about both.
 *
 * One gap worth naming: `EvidenceView` carries `kind`, `excerpt`, `url` and
 * `confirmedByUser` — but no label. design/01 §4 specifies `SourceChip` as
 * `[◆ PR #482]` with `patronus/api` as detail, so the label is derived from
 * the URL here. Reported in the handoff.
 */

import type { EvidenceView, ImpactView, WinView } from '@/actions/wins.types';
import type {
  ImpactMetricValue,
  SourceRef,
  WinCategoryValue,
  WinRecord,
  WinSensitivityValue,
} from '@/components/patterns';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

const KIND_FALLBACK: Record<EvidenceView['kind'], string> = {
  repo: 'Repository',
  document: 'Document',
  url: 'Link',
  interview_assertion: 'You said this',
  metric_confirmed: 'Confirmed metric',
  import: 'Import',
};

/** `https://github.com/patronus/api/pull/482` → `PR #482` · `patronus/api`. */
function labelFromUrl(url: string): { label: string; detail?: string } | null {
  try {
    const parsed = new URL(url);
    const pull = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(parsed.pathname);
    if (pull) return { label: `PR #${pull[2]}`, detail: pull[1] };

    const file = parsed.pathname.split('/').filter(Boolean).pop();
    if (file && file.includes('.')) return { label: file, detail: parsed.hostname };

    return { label: parsed.hostname.replace(/^www\./, ''), detail: undefined };
  } catch {
    return null;
  }
}

export function toSourceRef(evidence: EvidenceView): SourceRef {
  const derived = evidence.url ? labelFromUrl(evidence.url) : null;
  return {
    id: evidence.id,
    kind: evidence.kind,
    label: derived?.label ?? KIND_FALLBACK[evidence.kind],
    detail: derived?.detail,
    excerpt: evidence.excerpt || undefined,
    url: evidence.url ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Impact                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The chip shows the sharpest available figure. `delta` beats `result` beats
 * the bare metric name, because "−77%" lands and "p95 latency" does not.
 */
export function toMetricValue(impact: ImpactView | null): ImpactMetricValue | null {
  if (!impact) return null;
  const value = impact.delta ?? impact.result ?? impact.metric;
  const range =
    impact.baseline && impact.result ? `${impact.baseline} → ${impact.result}` : null;
  const detail = [range, impact.metric, impact.scope, impact.timeframe]
    .filter((part): part is string => Boolean(part) && part !== value)
    .join(' · ');
  return { value, detail: detail || undefined };
}

/** The Impact block in the drawer reads as a sentence, not a chip. */
export function impactSentence(impact: ImpactView): string {
  const range =
    impact.baseline && impact.result
      ? `${impact.baseline} → ${impact.result}`
      : (impact.result ?? impact.delta ?? '');
  const delta = impact.delta && impact.baseline && impact.result ? ` (${impact.delta})` : '';
  return `${range}${delta}`.trim();
}

/* -------------------------------------------------------------------------- */
/* Win                                                                         */
/* -------------------------------------------------------------------------- */

export function toWinRecord(win: WinView): WinRecord {
  return {
    id: win.id,
    title: win.title,
    occurredAt: win.occurredAt,
    category: win.category as WinCategoryValue,
    sensitivity: win.sensitivity as WinSensitivityValue,
    ground: win.groundState,
    employer: win.employerName ?? undefined,
    narrative: win.narrative,
    sources: win.evidence.map(toSourceRef),
    metric: toMetricValue(win.impact),
    skills: win.skills,
  };
}

/* -------------------------------------------------------------------------- */
/* Month grouping                                                              */
/* -------------------------------------------------------------------------- */

export interface MonthGroup {
  /** `2026-07`. Stable across renders; used as the React key. */
  key: string;
  /** `JULY 2026`. */
  label: string;
  wins: WinView[];
}

/**
 * Groups by UTC month, preserving the incoming order (newest first).
 *
 * UTC, not locale: `formatWinDate` is UTC for the same reason, and a header
 * that says JULY over a card that says Jun 30 is the kind of bug nobody
 * reports and everybody notices.
 */
export function groupByMonth(wins: WinView[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let current: MonthGroup | null = null;

  for (const win of wins) {
    const year = win.occurredAt.getUTCFullYear();
    const month = win.occurredAt.getUTCMonth();
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    if (!current || current.key !== key) {
      current = { key, label: `${MONTHS[month]} ${year}`, wins: [] };
      groups.push(current);
    }
    current.wins.push(win);
  }

  return groups;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/* -------------------------------------------------------------------------- */
/* The standing record statement — design/02 §B, PRD 09 §4 M3                  */
/* -------------------------------------------------------------------------- */

export function recordSpanYears(recordStart: Date | null, now: Date): number {
  if (!recordStart) return 0;
  const years = (now.getTime() - recordStart.getTime()) / (365.25 * 86_400_000);
  return Math.max(1, Math.round(years));
}
