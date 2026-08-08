import { PipelineStep } from '@prisma/client';

/**
 * What the user is told is happening, during a two-to-four minute wait.
 *
 * "60-90 second" was measured against v1. The 8 Aug audit clocked three live
 * v2 runs at 200s, 231s and 138s — the labels were rewritten to stop lying
 * about the WORK and kept a duration that was off by 2-3x, which is its own
 * small lie and the one a waiting user can check.
 *
 * These described v1's plumbing — "Parsing job requirements", "Rewriting
 * bullets for impact", "Scoring ATS compatibility". v2 does different work
 * under the same `PipelineStep` values, and two of those labels were by then
 * simply untrue: nothing paraphrases in bulk any more, and the score is
 * requirement coverage rather than ATS keyword overlap.
 *
 * They now name the interesting step rather than the mechanical one. The
 * selection pass in particular is the thing worth waiting for, and telling
 * someone their evidence is being weighed against the posting is both accurate
 * and more reassuring than "paraphrasing".
 */
const STEP_LABELS: Record<PipelineStep, string> = {
  reuse_check: 'Checking for a resume you already have',
  jd_parsing: 'Reading what this employer asks for',
  semantic_search: 'Finding your most relevant work',
  static_data_load: 'Loading your history',
  awaiting_clarification: 'Waiting for clarification',
  paraphrasing: 'Choosing what earns space, and writing it',
  resume_assembly: 'Assembling the document',
  claim_validation: 'Checking every claim against your history',
  ats_scoring: 'Measuring it against the posting',
  pdf_generation: 'Generating export-ready PDF',
  completed: 'Resume ready',
};

const STEP_ORDER: PipelineStep[] = [
  PipelineStep.reuse_check,
  PipelineStep.jd_parsing,
  PipelineStep.semantic_search,
  PipelineStep.static_data_load,
  PipelineStep.awaiting_clarification,
  PipelineStep.paraphrasing,
  PipelineStep.resume_assembly,
  PipelineStep.claim_validation,
  PipelineStep.ats_scoring,
  PipelineStep.pdf_generation,
  PipelineStep.completed,
];

export function getGenerationStageLabel(step: PipelineStep | null | undefined): string {
  if (!step) return 'Preparing your session';
  return STEP_LABELS[step] ?? 'Processing your resume';
}

export function getGenerationProgressPercent(step: PipelineStep | null | undefined): number {
  if (!step) return 5;
  if (step === PipelineStep.awaiting_clarification) return 30;

  const index = STEP_ORDER.indexOf(step);
  if (index < 0) return 5;
  const ratio = index / (STEP_ORDER.length - 1);
  return Math.max(5, Math.round(ratio * 100));
}

export function getGenerationDetailLines(params: {
  step: PipelineStep | null | undefined;
  requiredSkills?: number;
  preferredSkills?: number;
  matchedProjects?: number;
  matchedAchievements?: number;
  atsScore?: number | null;
}): string[] {
  const lines: string[] = [];

  if (params.step === PipelineStep.jd_parsing) {
    const totalSkills = (params.requiredSkills ?? 0) + (params.preferredSkills ?? 0);
    if (totalSkills > 0) {
      lines.push(`Found ${totalSkills} targeted skills in the job description.`);
    }
  }

  if (params.step === PipelineStep.semantic_search) {
    const projects = params.matchedProjects ?? 0;
    const achievements = params.matchedAchievements ?? 0;
    if (projects > 0 || achievements > 0) {
      lines.push(`Matched ${projects} projects and ${achievements} supporting achievements.`);
    }
  }

  if ((params.step === PipelineStep.ats_scoring || params.step === PipelineStep.completed) && typeof params.atsScore === 'number') {
    // Not an ATS estimate. It is the share of the posting's stated
    // requirements this resume answers — the one term the rebuild's own
    // documentation says it abandoned, still being printed to the user.
    lines.push(`Answering ${params.atsScore}% of what this posting asks for.`);
  }

  if (params.step === PipelineStep.pdf_generation) {
    lines.push('Compiling the PDF version and storing it for download.');
  }

  return lines;
}
