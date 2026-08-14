'use server';

import { auth } from '@clerk/nextjs/server';
import { GroundState } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ResumeData } from '@/types/resume';
import { collectClaimLines } from '@/services/claimValidator';
import { claimRefIdFor, RESUME_CLAIM_TYPE } from '@/services/claimGrounding';

export type ClaimChip = {
  claim: string;
  state: GroundState;
  confirmedByUser: boolean;
};

export type ClaimGroundingsResult = {
  success: boolean;
  chips: ClaimChip[];
  counts: Record<GroundState, number>;
  error?: string;
};

function emptyCounts(): Record<GroundState, number> {
  return {
    [GroundState.grounded]: 0,
    [GroundState.needs_confirmation]: 0,
    [GroundState.unsupported]: 0,
  };
}

/**
 * Return the truthfulness chip for each claim in a resume, joining the persisted
 * ClaimLink/Evidence ground states to the resume's current claim lines. All
 * hashing stays server-side; the client matches chips to bullets by claim text.
 */
export async function getResumeClaimGroundings(resumeId: string): Promise<ClaimGroundingsResult> {
  const { userId } = await auth();
  if (!userId) return { success: false, chips: [], counts: emptyCounts(), error: 'Not authenticated' };

  const resume = await prisma.resume.findFirst({
    where: { id: resumeId, userId },
    select: { content: true },
  });
  if (!resume?.content) {
    return { success: false, chips: [], counts: emptyCounts(), error: 'Resume not found' };
  }

  const data = resume.content as unknown as ResumeData;
  const lines = Array.from(new Set(collectClaimLines(data).map((l) => l.trim()).filter(Boolean)));
  if (lines.length === 0) return { success: true, chips: [], counts: emptyCounts() };

  const byRefId = new Map(lines.map((claim) => [claimRefIdFor(resumeId, claim), claim]));

  const links = await prisma.claimLink.findMany({
    where: {
      userId,
      claimType: RESUME_CLAIM_TYPE,
      claimRefId: { in: Array.from(byRefId.keys()) },
    },
    select: { claimRefId: true, groundState: true, evidence: { select: { confirmedByUser: true } } },
  });

  const counts = emptyCounts();
  const chips: ClaimChip[] = [];
  for (const link of links) {
    const claim = byRefId.get(link.claimRefId);
    if (!claim) continue;
    counts[link.groundState] += 1;
    chips.push({
      claim,
      state: link.groundState,
      confirmedByUser: link.evidence?.confirmedByUser ?? false,
    });
  }

  return { success: true, chips, counts };
}

/**
 * Confirm a `needs_confirmation` claim in one click: upgrades its ClaimLink to
 * `grounded` and marks its Evidence `confirmedByUser=true`, writing the
 * confirmation back into the graph (the compounding loop, §3.4).
 */
export async function confirmResumeClaim(
  resumeId: string,
  claim: string
): Promise<{ success: boolean; state?: GroundState; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const claimRefId = claimRefIdFor(resumeId, claim);
  const link = await prisma.claimLink.findFirst({
    where: { userId, claimType: RESUME_CLAIM_TYPE, claimRefId },
    select: { id: true, evidenceId: true },
  });
  if (!link) return { success: false, error: 'Claim not found' };

  await prisma.$transaction([
    prisma.claimLink.update({
      where: { id: link.id },
      data: { groundState: GroundState.grounded },
    }),
    prisma.evidence.update({
      where: { id: link.evidenceId },
      data: { confirmedByUser: true, confidence: 1.0 },
    }),
  ]);

  return { success: true, state: GroundState.grounded };
}
