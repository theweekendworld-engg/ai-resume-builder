import type { ResumeData } from '@/types/resume';
import type { ParsedJDType } from '@/lib/aiSchemas';
import { normalizeText, uniqueStrings } from '@/lib/textUtils';

export function computeAtsEstimate(resume: ResumeData, parsedJD: ParsedJDType): number {
  const jdTerms = uniqueStrings([...parsedJD.requiredSkills, ...parsedJD.preferredSkills]).map(normalizeText);
  if (jdTerms.length === 0) return 70;
  const resumeText = normalizeText(JSON.stringify(resume));
  const matches = jdTerms.filter((term) => term && resumeText.includes(term)).length;
  const score = Math.round((matches / jdTerms.length) * 100);
  return Math.max(40, Math.min(95, score));
}

/**
 * Reorder the skills section toward what the posting asks for.
 *
 * ── The bug that was here ───────────────────────────────────────────────────
 *
 * This function built an evidence-filtered `candidateSkills` list and then
 * discarded the filter, prepending `requiredSkills` and `preferredSkills`
 * unfiltered and letting `slice(0, 20)` push the evidenced ones off the end.
 * In the 7 Aug audit run, 10 of the 13 skills on the finished resume had no
 * evidence anywhere in the candidate's history — Go, Java, PostgreSQL, AWS,
 * Terraform, gRPC — against a product whose headline promise is that it never
 * fabricates. Nothing downstream caught it: `collectClaimLines` walks
 * experience and projects only, so the skills array had no grounding check.
 *
 * It now reorders and never adds. A posting skill the candidate cannot
 * evidence is not a line on their resume; it is a gap, and
 * `src/lib/resume/skills.ts` reports it as one.
 */
export function improveResumeForLowAts(params: {
  resume: ResumeData;
  parsedJD: ParsedJDType;
  missingKeywords: string[];
  sourceTextCorpus: string;
}): ResumeData {
  const sourceText = normalizeText(params.sourceTextCorpus);

  const evidenced = (entry: string): boolean => {
    const normalized = normalizeText(entry);
    return normalized.length > 0 && sourceText.includes(normalized);
  };

  // Wanted AND evidenced leads — same skills, better order for a scanner.
  const wanted = uniqueStrings([
    ...params.parsedJD.requiredSkills,
    ...params.parsedJD.preferredSkills,
    ...params.missingKeywords,
  ]).filter(evidenced);

  // Then whatever the resume already carried, in its existing order. Not
  // re-filtered: it arrived through a path that gated it, and silently
  // dropping a skill here would be a second bug in the opposite direction.
  const ordered = uniqueStrings([...wanted, ...params.resume.skills]).slice(0, 20);

  return {
    ...params.resume,
    skills: ordered.length > 0 ? ordered : params.resume.skills,
  };
}
