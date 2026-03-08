import type { KnowledgeItem, UserProject } from '@prisma/client';

const PROJECT_README_CONTEXT_CHARS = 1200;

export function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);
}

export function extractMetricTokens(value: string): string[] {
    const matches = value.match(/\b\d+(?:[.,]\d+)?(?:%|\+|x|k|m|b)?\b/gi) ?? [];
    return matches.map((entry) => entry.toLowerCase());
}

export function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function toCompactJson(value: unknown): string {
    return JSON.stringify(value);
}

export function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

export function getProjectText(project: Pick<UserProject, 'name' | 'description' | 'technologies' | 'readme'>): string {
    const technologies = Array.isArray(project.technologies) ? (project.technologies as string[]) : [];
    return [project.name, project.description, technologies.join(' '), project.readme.slice(0, PROJECT_README_CONTEXT_CHARS)].join(' ').trim();
}

export function getKnowledgeText(item: Pick<KnowledgeItem, 'title' | 'content'>): string {
    return `${item.title} ${item.content}`.trim();
}
