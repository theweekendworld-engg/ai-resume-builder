import { EvidenceKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ResumeData } from '@/types/resume';
import type { ClaimValidation } from '@/services/claimValidator';
import { deriveClaimGroundings, RESUME_CLAIM_TYPE } from '@/services/claimGrounding';

/**
 * Persist per-claim ground states for a generated resume as Evidence + ClaimLink
 * rows (v2 architecture §3.1 / §4.1). Best-effort: callers wrap this so a
 * failure here never breaks resume generation.
 *
 * Regeneration semantics: user-confirmed claims (Evidence.confirmedByUser) are
 * PRESERVED across regenerations — the compounding loop must not lose a
 * confirmation. Everything else for this resume is rebuilt from the fresh
 * validation.
 */
export async function persistClaimGroundings(params: {
  userId: string;
  resumeId: string;
  resume: ResumeData;
  validation: ClaimValidation;
}): Promise<void> {
  const { userId, resumeId, resume, validation } = params;
  const groundings = deriveClaimGroundings(resumeId, resume, validation);
  const refPrefix = `${resumeId}:`;

  await prisma.$transaction(async (tx) => {
    // Preserve user-confirmed claims; wipe & rebuild the rest.
    const confirmed = await tx.claimLink.findMany({
      where: {
        userId,
        claimType: RESUME_CLAIM_TYPE,
        claimRefId: { startsWith: refPrefix },
        evidence: { confirmedByUser: true },
      },
      select: { claimRefId: true },
    });
    const confirmedSet = new Set(confirmed.map((c) => c.claimRefId));

    const stale = await tx.claimLink.findMany({
      where: {
        userId,
        claimType: RESUME_CLAIM_TYPE,
        claimRefId: { startsWith: refPrefix },
        evidence: { confirmedByUser: false },
      },
      select: { evidenceId: true },
    });
    // Deleting the Evidence cascades its ClaimLink (onDelete: Cascade).
    if (stale.length > 0) {
      await tx.evidence.deleteMany({ where: { id: { in: stale.map((s) => s.evidenceId) }, userId } });
    }

    for (const g of groundings) {
      if (confirmedSet.has(g.claimRefId)) continue; // keep the confirmed grounding
      const evidence = await tx.evidence.create({
        data: {
          userId,
          kind: EvidenceKind.import,
          sourceRef: g.sourceRef,
          excerpt: g.claim.slice(0, 2000),
          confidence: g.confidence,
          confirmedByUser: false,
        },
        select: { id: true },
      });
      await tx.claimLink.create({
        data: {
          userId,
          claimType: RESUME_CLAIM_TYPE,
          claimRefId: g.claimRefId,
          evidenceId: evidence.id,
          groundState: g.state,
        },
      });
    }
  });
}
