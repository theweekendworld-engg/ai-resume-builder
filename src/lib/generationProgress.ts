import { PipelineStep } from '@prisma/client';

const STEP_LABELS: Record<PipelineStep, string> = {
  reuse_check: 'Checking reusable drafts',
  jd_parsing: 'Parsing job requirements',
  semantic_search: 'Finding relevant projects and experience',
  static_data_load: 'Loading your profile context',
  awaiting_clarification: 'Waiting for clarification',
  paraphrasing: 'Rewriting bullets for impact',
  resume_assembly: 'Assembling your baseline resume',
  claim_validation: 'Validating claims',
  ats_scoring: 'Scoring ATS compatibility',
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
    lines.push(`Current ATS estimate: ${params.atsScore}%.`);
  }

  if (params.step === PipelineStep.pdf_generation) {
    lines.push('Compiling the PDF version and storing it for download.');
  }

  return lines;
}
