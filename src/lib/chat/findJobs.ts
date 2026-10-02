/**
 * `find_jobs`: open postings from the boards Radar already ingests
 * (Greenhouse, Ashby). Plain SQL over our own rows, no model, no web search.
 *
 * Honest about coverage: those boards are mostly US and EU tech companies, so
 * an empty result says what was searched rather than implying the market is
 * empty (docs/prd/10-chat.md §5, job discovery breadth).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ChatPosting } from './types';

export const POSTINGS_LIMIT = 8;
/** Words that say nothing about the role. */
const STOP = new Set(['jobs', 'job', 'role', 'roles', 'opening', 'openings', 'position', 'positions', 'find', 'me', 'a', 'an', 'the', 'for', 'in', 'at', 'and', 'or', 'with', 'some', 'any', 'remote', 'hiring', 'my', 'i', 'what', 'did', 'do', 'work', 'about', 'on', 'tell', 'show', 'last', 'this', 'that', 'of', 'to', 'is', 'was', 'inc', 'ltd', 'llc']);

export function searchTerms(query: string | null): string[] {
    return (query ?? '')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2 && !STOP.has(term))
        .slice(0, 5);
}

export function formatPay(row: {
    compLow: number | null;
    compHigh: number | null;
    compCurrency: string | null;
    compPeriod: string | null;
}): string | null {
    if (row.compLow === null && row.compHigh === null) return null;
    const fmt = (value: number) => value.toLocaleString('en-US');
    const range = row.compLow !== null && row.compHigh !== null && row.compLow !== row.compHigh
        ? `${fmt(row.compLow)}–${fmt(row.compHigh)}`
        : fmt((row.compLow ?? row.compHigh) as number);
    return [row.compCurrency, range, row.compPeriod ? `per ${row.compPeriod}` : null].filter(Boolean).join(' ');
}

export async function findPostings(params: {
    query: string | null;
    location: string | null;
    remoteOnly: boolean;
    /** A company the user named. Matched on the board's company, never on the title. */
    company?: string | null;
}): Promise<{ items: ChatPosting[]; searched: number }> {
    const company = params.company?.trim() || null;
    // "Engineering jobs at Anthropic": the company is not a title word. With
    // it in the terms, every posting failed the all-words match (QA 2026-10-02).
    const companyWords = new Set(searchTerms(company));
    const terms = searchTerms(params.query).filter((term) => !companyWords.has(term));
    const where: Prisma.JobPostingWhereInput = {
        closedAt: null,
        AND: [
            ...terms.map((term) => ({
                OR: [
                    { title: { contains: term, mode: 'insensitive' as const } },
                    { department: { contains: term, mode: 'insensitive' as const } },
                ],
            })),
            ...(params.location?.trim()
                ? [{ location: { contains: params.location.trim(), mode: 'insensitive' as const } }]
                : []),
            ...(params.remoteOnly ? [{ location: { contains: 'remote', mode: 'insensitive' as const } }] : []),
            ...(company ? [{ source: { companyName: { contains: company, mode: 'insensitive' as const } } }] : []),
        ],
    };
    const [rows, searched] = await Promise.all([
        prisma.jobPosting.findMany({
            where,
            orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            take: POSTINGS_LIMIT,
            select: {
                id: true, title: true, location: true, absoluteUrl: true, postedAt: true,
                compLow: true, compHigh: true, compCurrency: true, compPeriod: true,
                source: { select: { companyName: true } },
            },
        }),
        prisma.jobPosting.count({ where: { closedAt: null } }),
    ]);
    return {
        searched,
        items: rows.map((row) => ({
            id: row.id,
            company: row.source.companyName,
            title: row.title,
            location: row.location,
            url: row.absoluteUrl,
            postedAt: row.postedAt ? row.postedAt.toISOString() : null,
            pay: formatPay(row),
        })),
    };
}
