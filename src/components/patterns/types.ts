/**
 * View-model types for the pattern library.
 *
 * These deliberately mirror the Prisma enums as plain string unions rather than
 * importing them. Importing enum *values* from `@prisma/client` drags
 * server-only code into the client bundle — the same reason `src/lib/groundState.ts`
 * exists. The members are identical, so a Prisma row assigns structurally.
 */

import type { GroundStateValue } from '@/lib/groundState';

export type { GroundStateValue };

/** Mirrors `WinCategory`. Eight members; order is the 1-8 reassign order. */
export const WIN_CATEGORIES = [
  'shipped',
  'improved',
  'fixed',
  'led',
  'influenced',
  'grew',
  'learned',
  'saved',
] as const;

export type WinCategoryValue = (typeof WIN_CATEGORIES)[number];

/** Mirrors `WinSensitivity`. */
export type WinSensitivityValue = 'shareable' | 'internal_only' | 'confidential';

/** Mirrors `EvidenceKind`. */
export type EvidenceKindValue =
  | 'repo'
  | 'metric_confirmed'
  | 'document'
  | 'url'
  | 'interview_assertion'
  | 'import';

/** A single piece of provenance, as rendered by `SourceChip`. */
export interface SourceRef {
  id: string;
  kind: EvidenceKindValue;
  /** Short human label: "PR #482", "Design review", "resume.pdf". */
  label: string;
  /** Stored excerpt, shown in the hover popover. Truncated to 240 chars. */
  excerpt?: string;
  /** External link, when the source still resolves. */
  url?: string;
  /**
   * The source no longer resolves. The chip renders struck through and muted —
   * the excerpt is still preserved and still shown.
   */
  dead?: boolean;
  /** Secondary context: "patronus/api". */
  detail?: string;
}

/** The quantified outcome attached to a Win, when one exists. */
export interface ImpactMetricValue {
  /** The headline figure, already formatted: "-77%", "3.2x", "$41k". */
  value: string;
  /** Optional expansion: "800ms -> 180ms". */
  detail?: string;
}

/** Everything `WinCard` needs to render. No relations, no Prisma types. */
export interface WinRecord {
  id: string;
  title: string;
  /** The date the work happened, never the date it was logged. */
  occurredAt: Date | string;
  category: WinCategoryValue;
  sensitivity?: WinSensitivityValue;
  /** Truthfulness state. Drives the status dot and the `GroundChip`. */
  ground?: GroundStateValue;
  employer?: string;
  narrative?: string;
  sources?: SourceRef[];
  /**
   * Absence is meaningful: no metric chip is the visual cue that drives the
   * "quantify this" prompt.
   */
  metric?: ImpactMetricValue | null;
  skills?: string[];
}
