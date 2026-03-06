import type { ResumeData } from '@/types/resume';
import type { SmartResumePipelineResult } from '@/actions/generateResume';
import type { Result } from '@/lib/result';

export type ResumeAgentStep = {
  tool: string;
  status: 'started' | 'completed' | 'failed';
  data?: unknown;
};

export type ResumeAgentResult = SmartResumePipelineResult & {
  resume: ResumeData;
};

export type ResumeAgentResponse = Result<ResumeAgentResult>;
