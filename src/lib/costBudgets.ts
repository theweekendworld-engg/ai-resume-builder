/**
 * Per-feature cost ceilings (PRD 08 §4.3).
 *
 * These are DEFECT TRIPWIRES, not spend controls. Career-tier inference costs
 * roughly $0.08/user/month, so a breach almost never means "this feature is
 * expensive" — it means a retry loop, a missing cache, or an uncached prompt.
 * Investigate the cause; do not downgrade the model.
 *
 * Lives in lib rather than beside `getOpsSnapshot` because `src/actions/ops.ts`
 * is `'use server'`, and Next permits only async function exports there — a
 * constant in that file compiles under tsc and fails the build.
 */
export const COST_TRIPWIRES_USD: Record<string, number> = {
  work_log: 0.02,
  capture: 0.02,
  digest: 0.02,
  month_review: 0.05,
  review_packet: 0.25,
  backfill: 0.5,
  radar: 0.03,
  tailoring: 0.2,
};
