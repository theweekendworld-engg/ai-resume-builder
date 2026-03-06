import type { ResumeData } from '@/types/resume';

export type ClaimValidation = {
  valid: boolean;
  coverageRate: number;
  unsupportedClaims: string[];
  mappings: Record<string, string>;
  unsupportedMetricClaims: string[];
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function extractMetricTokens(value: string): string[] {
  const matches = value.match(/\b\d+(?:[.,]\d+)?(?:%|\+|x|k|m|b)?\b/gi) ?? [];
  return matches.map((entry) => entry.toLowerCase());
}

export function validateClaims(
  resume: ResumeData,
  sources: Array<{ id: string; text: string }>
): ClaimValidation {
  const sourceMetricTokens = new Set(sources.flatMap((source) => extractMetricTokens(source.text)));
  const sourceTokens = sources.map((source) => ({ id: source.id, tokens: new Set(tokenize(source.text)) }));

  const claimLines: string[] = [];
  for (const exp of resume.experience) {
    claimLines.push(...exp.description.split('\n').map((line) => line.trim()).filter(Boolean));
  }
  for (const project of resume.projects) {
    if (project.description.trim()) claimLines.push(project.description.trim());
  }

  const mappings: Record<string, string> = {};
  const unsupportedClaims: string[] = [];
  const unsupportedMetricClaims: string[] = [];

  for (const line of claimLines) {
    const claimTokens = tokenize(line);
    if (claimTokens.length < 3) {
      mappings[line] = 'short-claim';
      continue;
    }

    const metricTokens = extractMetricTokens(line);
    const hasUnsupportedMetric = metricTokens.some((token) => !sourceMetricTokens.has(token));
    if (hasUnsupportedMetric) {
      unsupportedClaims.push(line);
      unsupportedMetricClaims.push(line);
      continue;
    }

    let bestSourceId = '';
    let bestOverlap = 0;
    for (const source of sourceTokens) {
      let overlap = 0;
      for (const token of claimTokens) {
        if (source.tokens.has(token)) overlap += 1;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSourceId = source.id;
      }
    }

    const coverage = bestOverlap / claimTokens.length;
    if (coverage >= 0.22 && bestOverlap >= 3) {
      mappings[line] = bestSourceId;
    } else {
      unsupportedClaims.push(line);
    }
  }

  const supported = claimLines.length - unsupportedClaims.length;
  const coverageRate = claimLines.length > 0 ? supported / claimLines.length : 1;
  return { valid: unsupportedClaims.length === 0, coverageRate, unsupportedClaims, mappings, unsupportedMetricClaims };
}

export function sanitizeUnsupportedClaims(resume: ResumeData, unsupportedClaims: string[]): ResumeData {
  if (unsupportedClaims.length === 0) return resume;
  const bad = new Set(unsupportedClaims.map((claim) => claim.trim()));
  return {
    ...resume,
    experience: resume.experience.map((exp) => ({
      ...exp,
      description: exp.description
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !bad.has(line))
        .join('\n'),
    })),
    projects: resume.projects.map((project) => ({
      ...project,
      description: bad.has(project.description.trim()) ? '' : project.description,
    })),
  };
}
