/**
 * Paywall surfaces PW1–PW7 (PRD 06 §4).
 *
 * `copy` and the components are safe anywhere. `./data` is server-only — import
 * it directly from a server component or action, never through this barrel, so
 * a client bundle can't accidentally pull Prisma in.
 */

export { Paywall, type PaywallProps } from './Paywall';
export {
  ProactiveDowngradeCard,
  type ProactiveDowngradeCardProps,
} from './ProactiveDowngradeCard';
export {
  SOFT_MODE_NOTE,
  pw1GapsAnalysis,
  pw2HiddenHistory,
  pw3TailoredExhausted,
  pw4MarketSignal,
  pw5MissionNeedsSearch,
  pw6ReviewNudge,
  pw7SourceLimit,
  type PaywallCode,
  type PaywallContent,
} from './copy';
