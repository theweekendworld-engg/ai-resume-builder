import { createOpenAI } from '@ai-sdk/openai';
import { config } from '@/lib/config';

const provider = createOpenAI({
  apiKey: config.openai.apiKey,
});

export function aiOpenAI(model: string) {
  return provider(model);
}
