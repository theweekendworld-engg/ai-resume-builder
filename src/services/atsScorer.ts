import type { ResumeData } from '@/types/resume';
import type { ParsedJDType } from '@/lib/aiSchemas';

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function computeAtsEstimate(resume: ResumeData, parsedJD: ParsedJDType): number {
  const jdTerms = uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills]).map(normalizeText);
  if (jdTerms.length === 0) return 70;
  const resumeText = normalizeText(JSON.stringify(resume));
  const matches = jdTerms.filter((term) => term && resumeText.includes(term)).length;
  const score = Math.round((matches / jdTerms.length) * 100);
  return Math.max(40, Math.min(95, score));
}

export function improveResumeForLowAts(params: {
  resume: ResumeData;
  parsedJD: ParsedJDType;
  missingKeywords: string[];
  sourceTextCorpus: string;
}): ResumeData {
  const sourceText = normalizeText(params.sourceTextCorpus);
  const candidateSkills = uniqueStrings([
    ...params.resume.skills,
    ...params.parsedJD.requiredSkills,
    ...params.parsedJD.preferredSkills,
    ...params.missingKeywords,
  ]).filter((entry) => {
    const normalized = normalizeText(entry);
    return normalized.length > 0 && sourceText.includes(normalized);
  });

  const ordered = uniqueStrings([
    ...params.parsedJD.requiredSkills,
    ...params.parsedJD.preferredSkills,
    ...candidateSkills,
  ]).slice(0, 20);

  return {
    ...params.resume,
    skills: ordered.length > 0 ? ordered : params.resume.skills,
  };
}
