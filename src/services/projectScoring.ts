import type { KnowledgeItem, UserProject } from '@prisma/client';
import type { ExperienceItem } from '@/types/resume';
import type { ParsedJDType } from '@/lib/aiSchemas';

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getProjectText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme'>): string {
  const technologies = Array.isArray(project.technologies) ? (project.technologies as string[]) : [];
  return [project.name, project.description, technologies.join(' '), project.readme.slice(0, 1200)].join(' ').trim();
}

function getKnowledgeText(item: Pick<KnowledgeItem, 'title' | 'content'>): string {
  return `${item.title} ${item.content}`.trim();
}

export function scoreProject(params: {
  project: UserProject;
  semanticScore: number;
  jdSkills: string[];
}): number {
  const semantic = Math.max(0, Math.min(1, params.semanticScore));
  const projectText = getProjectText(params.project);
  const normalizedProjectText = normalizeText(projectText);
  const skillHits = params.jdSkills.filter((skill) => normalizedProjectText.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;
  const ageMs = Date.now() - params.project.updatedAt.getTime();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const recency = Math.max(0, 1 - ageMs / (3 * oneYear));
  return (semantic * 0.65) + (skillCoverage * 0.25) + (recency * 0.1);
}

export function scoreKnowledge(params: {
  item: KnowledgeItem;
  semanticScore: number;
  jdSkills: string[];
}): number {
  const semantic = Math.max(0, Math.min(1, params.semanticScore));
  const text = normalizeText(getKnowledgeText(params.item));
  const skillHits = params.jdSkills.filter((skill) => text.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;
  const quantifiedBonus = /\d/.test(params.item.content) ? 0.1 : 0;
  return (semantic * 0.75) + (skillCoverage * 0.15) + quantifiedBonus;
}

export function scoreExperienceRelevance(params: {
  item: ExperienceItem;
  jdSkills: string[];
  parsedJD: ParsedJDType;
}): number {
  const text = normalizeText([params.item.role, params.item.company, params.item.description].join(' '));
  const skillHits = params.jdSkills.filter((skill) => text.includes(normalizeText(skill))).length;
  const skillCoverage = params.jdSkills.length > 0 ? Math.min(1, skillHits / params.jdSkills.length) : 0;
  const roleSignal = params.parsedJD.role ? (text.includes(normalizeText(params.parsedJD.role)) ? 1 : 0) : 0;
  const responsibilityHits = params.parsedJD.keyResponsibilities
    .slice(0, 8)
    .filter((entry) => text.includes(normalizeText(entry))).length;
  const responsibilityCoverage = params.parsedJD.keyResponsibilities.length > 0
    ? Math.min(1, responsibilityHits / Math.min(8, params.parsedJD.keyResponsibilities.length))
    : 0;
  return (skillCoverage * 0.55) + (roleSignal * 0.2) + (responsibilityCoverage * 0.25);
}
