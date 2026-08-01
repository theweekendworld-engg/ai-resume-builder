import { describe, expect, test } from 'bun:test';

import { CATEGORY_META } from './category-meta';
import { densityPadding } from './density';
import { WIN_CATEGORIES } from './types';
import { fadeDuration, motionDuration } from './use-reduced-motion';
import { formatWinDate } from './format';

/**
 * Pure-logic tests only. There is no DOM testing library in this project, and
 * adding one is out of scope for the pattern library; the visual and
 * interaction surface is reviewed at `/dev/patterns`.
 */

describe('formatWinDate', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');

  test('omits the year within the current year', () => {
    expect(formatWinDate('2026-07-14T00:00:00.000Z', now)).toBe('Jul 14');
    expect(formatWinDate('2026-01-03T00:00:00.000Z', now)).toBe('Jan 3');
  });

  test('includes the year outside the current year', () => {
    expect(formatWinDate('2025-11-03T00:00:00.000Z', now)).toBe('Nov 3, 2025');
    expect(formatWinDate('2027-02-28T00:00:00.000Z', now)).toBe('Feb 28, 2027');
  });

  test('accepts a Date as well as a string', () => {
    expect(formatWinDate(new Date('2026-12-25T00:00:00.000Z'), now)).toBe('Dec 25');
  });

  test('renders nothing for an unparseable date rather than "Invalid Date"', () => {
    expect(formatWinDate('not a date', now)).toBe('');
  });
});

describe('reduced motion (foundations §7.3)', () => {
  test('movement collapses to zero', () => {
    expect(motionDuration(180, true)).toBe(0);
    expect(motionDuration(180, false)).toBe(180);
  });

  test('crossfades are clamped to 100ms but never removed', () => {
    // The rule is "keep opacity crossfades at 100ms" — never remove feedback,
    // only movement.
    expect(fadeDuration(180, true)).toBe(100);
    expect(fadeDuration(80, true)).toBe(80);
    expect(fadeDuration(180, false)).toBe(180);
  });
});

describe('categories (foundations §3.3)', () => {
  test('every category has an icon and a label', () => {
    for (const category of WIN_CATEGORIES) {
      expect(CATEGORY_META[category]).toBeDefined();
      expect(CATEGORY_META[category].icon).toBeTruthy();
      expect(CATEGORY_META[category].label).toBe(category);
    }
  });

  test('no category carries a colour — eight hues would be a rainbow', () => {
    for (const category of WIN_CATEGORIES) {
      expect(Object.keys(CATEGORY_META[category]).sort()).toEqual(['icon', 'label']);
    }
  });

  test('there are exactly eight, so the 1-8 reassign keys map one to one', () => {
    expect(WIN_CATEGORIES).toHaveLength(8);
    expect(new Set(WIN_CATEGORIES).size).toBe(8);
  });

  test('the order matches the documented keyboard mapping', () => {
    expect([...WIN_CATEGORIES]).toEqual([
      'shipped',
      'improved',
      'fixed',
      'led',
      'influenced',
      'grew',
      'learned',
      'saved',
    ]);
  });
});

describe('density (foundations §5.4)', () => {
  test('padding uses only the 4px scale from §5.1', () => {
    // The doc writes pixels (py-8 px-12); Tailwind's scale is 4px-based.
    expect(densityPadding.compact).toBe('py-2 px-3');
    expect(densityPadding.default).toBe('py-3 px-4');
    expect(densityPadding.relaxed).toBe('py-5 px-6');
  });
});
