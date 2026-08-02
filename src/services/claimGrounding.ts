import { createHash } from 'crypto';
import { GroundState } from '@prisma/client';
import type { ResumeData } from '@/types/resume';
import { collectClaimLines, type ClaimValidation } from '@/services/claimValidator';

/**
 * Truthfulness chip substrate (v2 architecture §4.1, Tier 0/1).
 *
 * Turns the heuristic `ClaimValidation` into a per-claim ground state that is
 * persisted as `ClaimLink` + `Evidence` rows — the graph substrate that powers
 * the visible ✓ grounded / ⚠ needs-confirmation / ✗ unsupported chips, and the
 * one-click "confirm" that writes evidence back into the graph.
 *
 * Fail-closed (§4.1): anything not *positively* grounded resolves DOWN, never
 * up. Short/ambiguous claims default to `needs_confirmation`; fabricated metrics
 * are the only `unsupported` state.
 */

export const RESUME_CLAIM_TYPE = 'resume_bullet';

export type ClaimGrounding = {
  /** The canonical (trimmed) claim text. */
  claim: string;
  /** Stable per-resume claim identity: `${resumeId}:${hash}`. */
  claimRefId: string;
  state: GroundState;
  /** Source id it was traced to, or a sentinel ('heuristic' | 'metric_unsupported'). */
  sourceRef: string;
  confidence: number;
};

/** Deterministic claim identity, stable across regenerations of the same resume. */
export function claimRefIdFor(resumeId: string, claim: string): string {
  const normalized = claim.trim().toLowerCase().replace(/\s+/g, ' ');
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 20);
  return `${resumeId}:${hash}`;
}

/**
 * Derive a ground state for every claim line in the resume from the validator
 * output. Deduplicates identical claim lines (same text → same identity).
 */
export function deriveClaimGroundings(
  resumeId: string,
  resume: ResumeData,
  validation: ClaimValidation
): ClaimGrounding[] {
  const unsupported = new Set(validation.unsupportedClaims.map((c) => c.trim()));
  const unsupportedMetric = new Set(validation.unsupportedMetricClaims.map((c) => c.trim()));

  const out: ClaimGrounding[] = [];
  const seen = new Set<string>();

  for (const line of collectClaimLines(resume)) {
    const claim = line.trim();
    if (!claim || seen.has(claim)) continue;
    seen.add(claim);

    let state: GroundState;
    let sourceRef: string;
    let confidence: number;

    if (unsupportedMetric.has(claim)) {
      // A fabricated number is the brand-fatal failure — hard unsupported.
      state = GroundState.unsupported;
      sourceRef = 'metric_unsupported';
      confidence = 0;
    } else if (unsupported.has(claim)) {
      // Non-metric claim with no source link → over-cautious, not over-confident.
      state = GroundState.needs_confirmation;
      sourceRef = 'heuristic';
      confidence = 0.4;
    } else {
      const mapped = validation.mappings[claim];
      if (mapped && mapped !== 'short-claim') {
        state = GroundState.grounded;
        sourceRef = mapped;
        confidence = 0.9;
      } else {
        // Too short to verify (or unmapped) — fail closed to needs_confirmation.
        state = GroundState.needs_confirmation;
        sourceRef = 'heuristic';
        confidence = 0.4;
      }
    }

    out.push({ claim, claimRefId: claimRefIdFor(resumeId, claim), state, sourceRef, confidence });
  }

  return out;
}
