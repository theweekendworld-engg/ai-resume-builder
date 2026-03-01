import { config } from '@/lib/config';
import { ParsedResumeSchema, RESUME_PARSE_PROMPT, type ParsedResumeData } from '@/lib/aiSchemas';
import { trackedChatCompletion } from '@/lib/usageTracker';
import { repairJSON } from '@/lib/aiSchemas';

export async function parseResumeText(text: string, userId: string): Promise<ParsedResumeData> {
  const truncated = text.slice(0, 12000);

  const response = await trackedChatCompletion(
    {
      model: config.openai.models.resumeParse,
      messages: [
        {
          role: 'system',
          content: RESUME_PARSE_PROMPT,
        },
        {
          role: 'user',
          content: `Resume text:\n\n${truncated}\n\nReturn ONLY a valid JSON object.`,
        },
      ],
      response_format: { type: 'json_object' },
    },
    {
      userId,
      operation: 'resume_parse',
      metadata: { textLength: truncated.length },
    }
  );

  const raw = response.choices[0]?.message?.content ?? '{}';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = JSON.parse(repairJSON(raw));
  }

  const result = ParsedResumeSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Resume parse validation failed: ${issues}`);
  }

  return result.data;
}
