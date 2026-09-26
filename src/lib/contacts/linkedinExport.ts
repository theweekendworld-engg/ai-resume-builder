/**
 * Parse LinkedIn's `Connections.csv` from the member data export.
 *
 * The file is not a clean CSV, in ways that break a naive parser:
 *
 *   - It opens with a free-text "Notes:" preamble (a quoted paragraph about
 *     email addresses, then a blank line) BEFORE the header row. The header is
 *     found by content, not assumed to be line one.
 *   - Fields are quoted when they contain commas ("Acme, Inc."), and quotes
 *     inside a field are doubled.
 *   - Line endings are CRLF, and some exports start with a UTF-8 BOM.
 *   - "Connected On" is "12 Mar 2024"; older exports used "12-Mar-24".
 *   - Email Address is empty for almost everyone (members opt out by default).
 *
 * Pure. No database — `import.ts` owns the write.
 */

import { normalizeCompanyName } from '@/lib/enrichment/companyName';

export type ParsedConnection = {
    fullName: string;
    firstName: string;
    lastName: string;
    profileUrl: string | null;
    email: string | null;
    company: string | null;
    normalizedCompany: string | null;
    position: string | null;
    connectedOn: Date | null;
};

export type ParseResult = {
    connections: ParsedConnection[];
    /** Rows present but unusable (no name). */
    skipped: number;
    /** False when no header row was found — probably not the right file. */
    recognised: boolean;
};

/** RFC 4180 tokeniser. Handles quotes, doubled quotes, CR/LF/CRLF. */
export function parseCsvRows(input: string): string[][] {
    const text = input.replace(/^﻿/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
            continue;
        }
        if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i += 1;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** "12 Mar 2024" or "12-Mar-24" → UTC midnight. Anything else → null. */
export function parseConnectedOn(value: string): Date | null {
    const match = value.trim().match(/^(\d{1,2})[\s-]([A-Za-z]{3,4})[\s-](\d{2}|\d{4})$/);
    if (!match) return null;
    const month = MONTHS[match[2].toLowerCase()];
    if (month === undefined) return null;
    let year = Number(match[3]);
    if (match[3].length === 2) year += 2000;
    const day = Number(match[1]);
    const date = new Date(Date.UTC(year, month, day));
    return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}

/**
 * `https://www.linkedin.com/in/jane-doe-12ab/` → `https://www.linkedin.com/in/jane-doe-12ab`.
 * The upsert key, so two exports of the same person collapse to one row.
 */
export function canonicalProfileUrl(value: string): string | null {
    const raw = value.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
        if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
        const slug = url.pathname.match(/^\/in\/([^/?#]+)/i);
        if (!slug) return null;
        return `https://www.linkedin.com/in/${decodeURIComponent(slug[1]).toLowerCase()}`;
    } catch {
        return null;
    }
}

const HEADER_KEYS = {
    firstName: 'first name',
    lastName: 'last name',
    url: 'url',
    email: 'email address',
    company: 'company',
    position: 'position',
    connectedOn: 'connected on',
} as const;

export function parseLinkedInConnections(csv: string): ParseResult {
    const rows = parseCsvRows(csv);
    const headerIndex = rows.findIndex((cells) => {
        const lower = cells.map((cell) => cell.trim().toLowerCase());
        return lower.includes(HEADER_KEYS.firstName) && lower.includes(HEADER_KEYS.url);
    });
    if (headerIndex < 0) return { connections: [], skipped: 0, recognised: false };

    const header = rows[headerIndex].map((cell) => cell.trim().toLowerCase());
    const col = (key: keyof typeof HEADER_KEYS) => header.indexOf(HEADER_KEYS[key]);
    const index = {
        firstName: col('firstName'),
        lastName: col('lastName'),
        url: col('url'),
        email: col('email'),
        company: col('company'),
        position: col('position'),
        connectedOn: col('connectedOn'),
    };
    const cell = (cells: string[], at: number) => (at >= 0 ? (cells[at] ?? '').trim() : '');

    const connections: ParsedConnection[] = [];
    let skipped = 0;
    for (const cells of rows.slice(headerIndex + 1)) {
        if (cells.every((value) => !value.trim())) continue;
        const firstName = cell(cells, index.firstName);
        const lastName = cell(cells, index.lastName);
        const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
        if (!fullName) {
            skipped += 1;
            continue;
        }
        const company = cell(cells, index.company) || null;
        const normalizedCompany = company ? normalizeCompanyName(company) || null : null;
        connections.push({
            fullName,
            firstName,
            lastName,
            profileUrl: canonicalProfileUrl(cell(cells, index.url)),
            email: cell(cells, index.email) || null,
            company,
            normalizedCompany,
            position: cell(cells, index.position) || null,
            connectedOn: parseConnectedOn(cell(cells, index.connectedOn)),
        });
    }
    return { connections, skipped, recognised: true };
}
