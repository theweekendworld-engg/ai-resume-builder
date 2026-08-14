/**
 * Bullet vocabulary, re-exported from the scorer that defines it.
 *
 * `select.ts` survived the pipeline deletion because `/score` still scores
 * bullets through it. This module exists so `coverage.ts` and `analyze.ts`
 * depend on a name rather than on which file happens to own it — the next time
 * a stage moves, the imports do not.
 */
export type { ScoredBullet, SourceBullet } from './select';
