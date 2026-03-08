import { normalizeWhitespace } from '@/lib/textUtils';

export const MAX_SUMMARY_WORDS = 55;
export const MAX_BULLET_WORDS = 26;
export const MAX_BULLETS_PER_EXPERIENCE = 4;
export const MAX_BULLETS_PER_PROJECT = 4;
export const MAX_SKILLS = 20;
export const MAX_EXPERIENCE_ITEMS = 4;

export function truncateWords(value: string, maxWords: number): string {
    const words = normalizeWhitespace(value).split(' ').filter(Boolean);
    if (words.length <= maxWords) return words.join(' ');
    return words.slice(0, maxWords).join(' ');
}

export function normalizeSummary(summary: string): string {
    return truncateWords(summary.replace(/\r\n/g, ' '), MAX_SUMMARY_WORDS);
}

export function splitDescriptionIntoBullets(description: string): string[] {
    return description
        .replace(/\r\n/g, '\n')
        .split('\n')
        .flatMap((line) => line.split(/[•●]/g))
        .map((line) => line.replace(/^\s*[-*]+\s*/, '').trim())
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
}

export function normalizeDescription(description: string, maxBullets: number): string {
    const bullets = splitDescriptionIntoBullets(description);
    if (bullets.length === 0) return '';

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const bullet of bullets) {
        const key = bullet.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(truncateWords(bullet, MAX_BULLET_WORDS));
        if (deduped.length >= maxBullets) break;
    }

    return deduped.join('\n');
}

export function normalizeSkills(skills: string[]): string[] {
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const skill of skills) {
        const cleaned = normalizeWhitespace(skill);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(cleaned);
        if (normalized.length >= MAX_SKILLS) break;
    }

    return normalized;
}
