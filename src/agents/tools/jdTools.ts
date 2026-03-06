import { z } from 'zod';
import { ParsedJDSchema } from '@/lib/aiSchemas';
import type { Result } from '@/lib/result';

const ParseJobDescriptionInput = z.object({
  jobDescription: z.string().min(20),
});

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractSkills(text: string): string[] {
  const commonSkills = [
    'typescript', 'javascript', 'react', 'next.js', 'node.js', 'python', 'java',
    'go', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'postgresql', 'mysql',
    'redis', 'graphql', 'rest', 'microservices', 'ci/cd', 'terraform', 'tailwind',
  ];
  const lower = text.toLowerCase();
  return commonSkills.filter((skill) => lower.includes(skill));
}

export async function parseJobDescriptionTool(input: unknown): Promise<Result<z.infer<typeof ParsedJDSchema>>> {
  const parsedInput = ParseJobDescriptionInput.safeParse(input);
  if (!parsedInput.success) {
    return {
      success: false,
      error: parsedInput.error.issues.map((issue) => issue.message).join('; '),
      code: 'INVALID_JOB_DESCRIPTION',
    };
  }

  const text = parsedInput.data.jobDescription;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? '';
  const roleGuess = /(?:role|position|title)\s*[:\-]\s*(.+)/i.exec(text)?.[1]?.trim()
    || firstLine.slice(0, 120);
  const companyGuess = /(?:company|at)\s*[:\-]?\s*([A-Za-z0-9 .&-]{2,80})/i.exec(text)?.[1]?.trim() || '';
  const requiredSkills = extractSkills(text);
  const grouped = requiredSkills.slice(0, 8);

  const candidate = ParsedJDSchema.parse({
    role: roleGuess,
    company: companyGuess,
    requiredSkills,
    preferredSkills: [],
    experienceLevel: '',
    keyResponsibilities: unique(lines.slice(0, 8)),
    industryDomain: '',
    skillGroups: grouped.length > 0
      ? [{ name: 'Core Skills', skills: grouped }]
      : [],
    seniorityLevel: /senior|lead|principal|staff/i.test(text) ? 'senior' : 'mid',
    isRemote: /remote|work from home|distributed/i.test(text),
    softSkills: unique(
      ['communication', 'leadership', 'collaboration', 'ownership', 'mentorship']
        .filter((skill) => text.toLowerCase().includes(skill))
    ),
  });

  return { success: true, data: candidate };
}
