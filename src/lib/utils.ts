import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { ResumeData } from "@/types/resume"
import { GitHubRepo } from "@/types/github"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';

  if (dateStr.includes('/')) {
    const [month, year] = dateStr.split('/');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }

  if (dateStr.includes('-') && dateStr.length >= 7) {
    const [year, month] = dateStr.split('-');
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const monthNum = parseInt(month, 10);
    if (monthNum >= 1 && monthNum <= 12) {
      return `${monthNames[monthNum - 1]} ${year}`;
    }
  }

  if (/^\d{4}$/.test(dateStr)) {
    return dateStr;
  }

  return dateStr;
}

/**
 * Calculate deterministic ATS signals without AI.
 * Returns partial scores that can be blended with LLM analysis.
 */
export function calculateDeterministicSignals(resumeData: ResumeData, jobDescription: string) {
  const jdLower = jobDescription.toLowerCase();
  const resumeText = JSON.stringify(resumeData).toLowerCase();

  // Extract words from job description (simple tokenization)
  const jdWords = jdLower.match(/\b[a-z]{3,}\b/g) || [];
  const uniqueJDWords = [...new Set(jdWords)];

  // Filter to likely keywords (longer words, tech terms)
  const possibleKeywords = uniqueJDWords.filter(w =>
    w.length >= 4 ||
    ['api', 'aws', 'sql', 'css', 'git', 'vue', 'ios'].includes(w)
  );

  // Calculate keyword overlap
  const matchedKeywords = possibleKeywords.filter(kw => resumeText.includes(kw));
  const keywordScore = possibleKeywords.length > 0
    ? Math.round((matchedKeywords.length / possibleKeywords.length) * 100)
    : 50;

  // Calculate skill match  
  const resumeSkillsLower = resumeData.skills.map(s => s.toLowerCase());
  const skillMatches = resumeSkillsLower.filter(skill =>
    jdLower.includes(skill) || possibleKeywords.some(kw => skill.includes(kw))
  );
  const skillScore = resumeData.skills.length > 0
    ? Math.round((skillMatches.length / Math.min(resumeData.skills.length, 15)) * 100)
    : 0;

  // Section completeness score
  let completenessScore = 0;
  if (resumeData.personalInfo.summary?.length > 50) completenessScore += 20;
  if (resumeData.experience.length > 0 && resumeData.experience[0].description.length > 50) completenessScore += 25;
  if (resumeData.projects.length > 0) completenessScore += 20;
  if (resumeData.education.length > 0) completenessScore += 15;
  if (resumeData.skills.length >= 5) completenessScore += 20;

  return {
    keywordScore: Math.min(100, keywordScore),
    skillScore: Math.min(100, skillScore),
    completenessScore: Math.min(100, completenessScore),
    matchedKeywords: matchedKeywords.slice(0, 15),
    missingKeywords: possibleKeywords
      .filter(kw => !resumeText.includes(kw))
      .slice(0, 10),
  };
}

/**
 * Get unique languages from a list of repos (useful for filter dropdown).
 */
export function getUniqueLanguages(repos: GitHubRepo[]): string[] {
  const langs = repos
    .map(r => r.language)
    .filter((l): l is string => l !== null && l.length > 0);
  return [...new Set(langs)].sort();
}
