import { generateText, tool } from 'ai';
import { z } from 'zod';
import { config } from '@/lib/config';
import { aiOpenAI } from '@/lib/aiProvider';
import { err, ok } from '@/lib/result';
import type { ResumeData } from '@/types/resume';
import type { ResumeAgentResponse, ResumeAgentStep } from '@/agents/types';
import { RESUME_AGENT_SYSTEM } from '@/agents/prompts';
import { parseJobDescriptionTool } from '@/agents/tools/jdTools';
import { loadUserContextTool, searchProjectsBySkillGroupTool } from '@/agents/tools/retrievalTools';
import { checkDataCompletenessTool, runLegacyPipelineTool } from '@/agents/tools/generationTools';
import { scoreAtsTool, validateClaimsTool } from '@/agents/tools/validationTools';
import type { SmartResumePipelineResult } from '@/actions/generateResume';

type RunResumeAgentParams = {
  jobDescription: string;
  userId: string;
  sessionId?: string;
  fallbackResumeData?: ResumeData;
  focusAreas?: string[];
  maxProjects?: number;
  onStep?: (step: ResumeAgentStep) => Promise<void>;
};

export async function runResumeAgent(params: RunResumeAgentParams): Promise<ResumeAgentResponse> {
  let pipelineResult: SmartResumePipelineResult | null = null;

  try {
    const userContext = await loadUserContextTool({ userId: params.userId });
    if (!userContext.success) {
      return err(userContext.error, userContext.code);
    }

    const completeness = await checkDataCompletenessTool({
      profile: userContext.data.profile
        ? {
          fullName: userContext.data.profile.fullName,
          email: userContext.data.profile.email,
          defaultTitle: userContext.data.profile.defaultTitle,
        }
        : null,
      experiences: userContext.data.experiences,
      projects: userContext.data.projects,
      education: userContext.data.education,
    });
    if (!completeness.success) {
      return err(completeness.error, completeness.code);
    }
    if (completeness.data.missing.length > 0) {
      return err(completeness.data.questions.join(' '), 'INSUFFICIENT_DATA');
    }

    await generateText({
      model: aiOpenAI(config.openai.models.general),
      system: RESUME_AGENT_SYSTEM,
      prompt: `Build a tailored resume for this job description:\n\n${params.jobDescription}`,
      tools: {
        parseJobDescription: tool({
          description: 'Parse job description into structured requirement fields',
          inputSchema: z.object({ jobDescription: z.string().min(20) }),
          execute: async ({ jobDescription }) => {
            await params.onStep?.({ tool: 'parseJobDescription', status: 'started' });
            const result = await parseJobDescriptionTool({ jobDescription });
            await params.onStep?.({ tool: 'parseJobDescription', status: result.success ? 'completed' : 'failed', data: result });
            return result;
          },
        }),
        searchProjectsBySkillGroup: tool({
          description: 'Run multi-vector project retrieval per skill group',
          inputSchema: z.object({
            role: z.string().default(''),
            skillGroups: z.array(z.object({ name: z.string(), skills: z.array(z.string()) })).default([]),
          }),
          execute: async ({ role, skillGroups }) => {
            await params.onStep?.({ tool: 'searchProjectsBySkillGroup', status: 'started' });
            const result = await searchProjectsBySkillGroupTool({
              userId: params.userId,
              sessionId: params.sessionId,
              role,
              skillGroups,
            });
            await params.onStep?.({ tool: 'searchProjectsBySkillGroup', status: result.success ? 'completed' : 'failed', data: result });
            return result;
          },
        }),
        runLegacyPipeline: tool({
          description: 'Generate full resume using production pipeline',
          inputSchema: z.object({ run: z.literal(true) }),
          execute: async () => {
            await params.onStep?.({ tool: 'runLegacyPipeline', status: 'started' });
            const result = await runLegacyPipelineTool({
              jobDescription: params.jobDescription,
              userId: params.userId,
              sessionId: params.sessionId,
              fallbackResumeData: params.fallbackResumeData,
              focusAreas: params.focusAreas,
              maxProjects: params.maxProjects,
            });
            if (result.success) {
              pipelineResult = result.data;
            }
            await params.onStep?.({ tool: 'runLegacyPipeline', status: result.success ? 'completed' : 'failed', data: result });
            return result;
          },
        }),
        validateClaims: tool({
          description: 'Run a semantic sanity check on major claims',
          inputSchema: z.object({ resume: z.unknown() }),
          execute: async ({ resume }) => validateClaimsTool({ resume }),
        }),
        scoreATS: tool({
          description: 'Compute ATS score for generated resume',
          inputSchema: z.object({ resume: z.unknown(), jobDescription: z.string().min(20) }),
          execute: async ({ resume, jobDescription }) => scoreAtsTool({
            userId: params.userId,
            sessionId: params.sessionId,
            resume,
            jobDescription,
          }),
        }),
      },
    });

    if (!pipelineResult) {
      return err('Agent did not produce a resume output', 'AGENT_EMPTY_RESULT');
    }

    return ok(pipelineResult);
  } catch (error: unknown) {
    return err(
      error instanceof Error ? error.message : 'Resume agent failed unexpectedly',
      'AGENT_RUNTIME_ERROR'
    );
  }
}
