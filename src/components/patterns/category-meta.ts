import {
  BookOpen,
  Flag,
  GitPullRequestArrow,
  Package,
  PiggyBank,
  Sprout,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { WinCategoryValue } from './types';

/**
 * §3.3 — categories get an icon, never a hue.
 *
 * Eight categories in eight colours is a rainbow: it looks like a bug tracker
 * and it makes the log harder to scan, not easier. One shape language, zero
 * colour noise. Do not add a `color` field to this map.
 */
export const CATEGORY_META: Record<
  WinCategoryValue,
  { label: string; icon: LucideIcon }
> = {
  shipped: { label: 'shipped', icon: Package },
  improved: { label: 'improved', icon: TrendingUp },
  fixed: { label: 'fixed', icon: Wrench },
  led: { label: 'led', icon: Flag },
  influenced: { label: 'influenced', icon: GitPullRequestArrow },
  grew: { label: 'grew', icon: Sprout },
  learned: { label: 'learned', icon: BookOpen },
  saved: { label: 'saved', icon: PiggyBank },
};
