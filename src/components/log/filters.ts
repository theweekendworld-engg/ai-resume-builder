/**
 * The Log filter model.
 *
 * design/02 §B: segmented `All / Drafts / Confirmed / Archived`, plus year,
 * employer, category and search. Filtering runs client-side here because the
 * record is under 200 Wins; above that the same shape maps onto `WinFilters`
 * and goes to the server (`toWinFilters` below is that bridge).
 */

import type { WinFilters, WinView } from '@/actions/wins.types';
import type { WinCategoryValue } from '@/components/patterns';

export type StatusSegment = 'all' | 'drafts' | 'confirmed' | 'archived';

export const STATUS_SEGMENTS: Array<{ value: StatusSegment; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'drafts', label: 'Drafts' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'archived', label: 'Archived' },
];

export interface LogFilterState {
  segment: StatusSegment;
  /** `null` means every year. */
  year: number | null;
  /** `null` means every employer; `'unattributed'` means Wins with none. */
  employerId: string | null;
  categories: WinCategoryValue[];
  search: string;
}

export const UNATTRIBUTED = 'unattributed';

export const NO_FILTERS: LogFilterState = {
  segment: 'all',
  year: null,
  employerId: null,
  categories: [],
  search: '',
};

/**
 * `All` is the working record: drafts and confirmed Wins. Archived has its own
 * segment, and folding it into `All` would make that segment meaningless.
 * Dismissed Wins never reach the log at all.
 */
function statusesFor(segment: StatusSegment): WinView['status'][] {
  switch (segment) {
    case 'drafts':
      return ['draft'];
    case 'confirmed':
      return ['confirmed'];
    case 'archived':
      return ['archived'];
    default:
      return ['draft', 'confirmed'];
  }
}

export function isFiltered(filters: LogFilterState): boolean {
  return (
    filters.segment !== 'all' ||
    filters.year !== null ||
    filters.employerId !== null ||
    filters.categories.length > 0 ||
    filters.search.trim() !== ''
  );
}

export function applyFilters(wins: WinView[], filters: LogFilterState): WinView[] {
  const statuses = statusesFor(filters.segment);
  const needle = filters.search.trim().toLowerCase();

  return wins.filter((win) => {
    if (!statuses.includes(win.status)) return false;
    if (filters.year !== null && win.occurredAt.getUTCFullYear() !== filters.year) return false;
    if (filters.employerId === UNATTRIBUTED) {
      if (win.employerId !== null) return false;
    } else if (filters.employerId !== null && win.employerId !== filters.employerId) {
      return false;
    }
    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(win.category as WinCategoryValue)
    ) {
      return false;
    }
    if (needle && !`${win.title} ${win.narrative}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The server-side form of the same filter, for records above 200 Wins. */
export function toWinFilters(filters: LogFilterState): WinFilters {
  return {
    status: statusesFor(filters.segment),
    category: filters.categories.length > 0 ? filters.categories : undefined,
    employerId:
      filters.employerId === UNATTRIBUTED
        ? null
        : filters.employerId === null
          ? undefined
          : filters.employerId,
    from: filters.year !== null ? new Date(Date.UTC(filters.year, 0, 1)) : undefined,
    to: filters.year !== null ? new Date(Date.UTC(filters.year, 11, 31, 23, 59, 59)) : undefined,
    search: filters.search.trim() || undefined,
  };
}

/** Years present in the record, newest first. */
export function yearOptions(wins: WinView[]): number[] {
  const years = new Set(wins.map((win) => win.occurredAt.getUTCFullYear()));
  return [...years].sort((a, b) => b - a);
}

export interface FilterChip {
  key: string;
  label: string;
  next: LogFilterState;
}

/** Active filters render as removable chips beneath the bar (§B). */
export function activeChips(
  filters: LogFilterState,
  employers: Array<{ id: string; name: string }>,
): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.segment !== 'all') {
    const label = STATUS_SEGMENTS.find((entry) => entry.value === filters.segment)?.label ?? '';
    chips.push({ key: 'segment', label, next: { ...filters, segment: 'all' } });
  }
  if (filters.year !== null) {
    chips.push({ key: 'year', label: String(filters.year), next: { ...filters, year: null } });
  }
  if (filters.employerId !== null) {
    const label =
      filters.employerId === UNATTRIBUTED
        ? 'No employer'
        : (employers.find((entry) => entry.id === filters.employerId)?.name ?? 'Employer');
    chips.push({ key: 'employer', label, next: { ...filters, employerId: null } });
  }
  for (const category of filters.categories) {
    chips.push({
      key: `category-${category}`,
      label: category,
      next: { ...filters, categories: filters.categories.filter((entry) => entry !== category) },
    });
  }
  if (filters.search.trim()) {
    chips.push({
      key: 'search',
      label: `“${filters.search.trim()}”`,
      next: { ...filters, search: '' },
    });
  }

  return chips;
}
