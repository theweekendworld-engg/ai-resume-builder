import type { ExperienceItem } from '@/types/resume';

export function parseResumeDateToTimestamp(raw: string): number {
    const value = raw.trim();
    if (!value) return 0;

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;

    const monthYear = value.match(/^(\d{1,2})[/-](\d{4})$/);
    if (monthYear) {
        const month = Number(monthYear[1]);
        const year = Number(monthYear[2]);
        if (month >= 1 && month <= 12) return Date.UTC(year, month - 1, 1);
    }

    const yearMonth = value.match(/^(\d{4})[/-](\d{1,2})$/);
    if (yearMonth) {
        const year = Number(yearMonth[1]);
        const month = Number(yearMonth[2]);
        if (month >= 1 && month <= 12) return Date.UTC(year, month - 1, 1);
    }

    const yearOnly = value.match(/^(\d{4})$/);
    if (yearOnly) {
        return Date.UTC(Number(yearOnly[1]), 0, 1);
    }

    return 0;
}

export function experienceRecencyScore(item: ExperienceItem): number {
    if (item.current) return Number.MAX_SAFE_INTEGER;
    const end = parseResumeDateToTimestamp(item.endDate);
    if (end > 0) return end;
    return parseResumeDateToTimestamp(item.startDate);
}
