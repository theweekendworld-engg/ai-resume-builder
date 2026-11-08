/**
 * Patronus pattern library.
 *
 * Specified in `docs/design/01-components.md`, grounded in
 * `docs/design/00-foundations.md`. Preview every variant and state at
 * `/dev/patterns`.
 *
 * These compose the primitives in `src/components/ui/`; they never replace them.
 */

export { CategoryChip, type CategoryChipProps } from './category-chip';
export { CATEGORY_META } from './category-meta';
export {
  DensityProvider,
  useDensity,
  densityPadding,
  densityRowGap,
  densityRowMinHeight,
  type Density,
  type DensityProviderProps,
} from './density';
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from './empty-state';
export { GroundChip, type GroundChipProps } from './ground-chip';
export { MetricChip, type MetricChipProps } from './metric-chip';
export {
  ProgressStages,
  type ProgressStage,
  type ProgressStageStatus,
  type ProgressStagesProps,
} from './progress-stages';
export { QuotaMeter, type QuotaMeterProps } from './quota-meter';
export { ReviewQueue, type ReviewQueueProps } from './review-queue';
export {
  SourceChip,
  SourceChipGroup,
  type SourceChipGroupProps,
  type SourceChipProps,
} from './source-chip';
export { StatTile, type StatTileProps } from './stat-tile';
export { StreakBadge, type StreakBadgeProps } from './streak-badge';
export {
  duration,
  easing,
  focusRing,
  focusRingOutline,
  focusRingOutlineStatic,
  touchTarget,
  typeStyles,
} from './tokens';
export {
  WIN_CATEGORIES,
  type EvidenceKindValue,
  type GroundStateValue,
  type ImpactMetricValue,
  type SourceRef,
  type WinCategoryValue,
  type WinRecord,
  type WinSensitivityValue,
} from './types';
export {
  fadeDuration,
  motionDuration,
  usePrefersReducedMotion,
} from './use-reduced-motion';
export { formatWinDate } from './format';
export {
  WinCard,
  WinCardSkeleton,
  type ConfirmPhase,
  type WinCardMenuAction,
  type WinCardProps,
  type WinCardState,
  type WinCardVariant,
} from './win-card';
export { EyebrowLink, InitialAvatar, PageBody, PageHeader, PageTabs, Pill, Segmented, pageContainer, type PageTab } from './page';

/* Dossier (2026-11-08, docs/design/03-dossier.md) */
export { Section, SectionLink, type SectionProps } from './section';
export { StatStrip, type StatStripItem, type StatStripProps } from './stat-strip';
export { EvidenceChip, EvidenceChipRow, type EvidenceChipProps } from './evidence-chip';
export {
  ProgressRail,
  type ProgressRailProps,
  type ProgressRailStatus,
  type ProgressRailStep,
} from './progress-rail';
