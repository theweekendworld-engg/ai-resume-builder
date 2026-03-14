import { failResumeImportSessionStep, processResumeImportSessionStep } from '@/workflows/steps/resumeImport';

export async function handleResumeImportWorkflow(sessionId: string) {
  'use workflow';

  try {
    await processResumeImportSessionStep(sessionId);
  } catch (error: unknown) {
    await failResumeImportSessionStep(
      sessionId,
      error instanceof Error ? error.message : 'Failed to parse resume import'
    );
  }
}
