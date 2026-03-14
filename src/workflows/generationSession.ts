import { executeGenerationSessionStep, notifyTelegramSessionStep } from '@/workflows/steps/generation';

export async function handleGenerationSessionWorkflow(sessionId: string) {
  'use workflow';

  try {
    await executeGenerationSessionStep(sessionId);
  } finally {
    await notifyTelegramSessionStep(sessionId);
  }
}
