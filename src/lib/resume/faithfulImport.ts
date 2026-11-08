import type { ParsedResumeData } from '@/lib/aiSchemas';

import {
    collapseWhitespace,
    extendToSentence,
    extractBullets,
    extractSkillGroups,
    findSpan,
    isPresentInSource,
    locateLine,
    matchKey,
    normalizeSourceText,
    noteAfter,
    readLines,
    splitItems,
    stackAfter,
    verbatimFromSource,
    withoutDateRange,
    type SourceBullet,
    type SourceLine,
} from './sourceText';

/**
 * Make a parsed resume say exactly what the resume says.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 * Every bullet in the source appears once, verbatim (whitespace collapsed).
 * No bullet appears that the source does not contain. Project bullets stay
 * bullets. Skills rows keep the resume's own labels. A company's tag line
 * and a role's stack line are kept as what they are, never turned into a
 * bullet.
 *
 * ── How ─────────────────────────────────────────────────────────────────────
 *
 * The model is trusted for one thing: which entries exist (this is a company,
 * that is a project). Each entry is located in the text by its name, and the
 * text between it and the next entry or heading is its region. Glyph-marked
 * bullets in a region are taken from the source, in order, and the model's
 * bullets for that entry are ignored. A region with no marked bullets — a
 * one-line internship — takes the model's lines only after finding each in
 * the region and reading it out to the end of its sentence, so a line the
 * model cut before its metric comes back whole. Anything the model wrote that
 * the source does not contain is rejected and reported.
 *
 * ── Root causes this replaces (QA 2026-11-07, finding 1) ────────────────────
 *
 *   - The schema had a free-text `description` per role, which the model
 *     filled with a summary made from the tag line; `fromParsed` then printed
 *     it as the first bullet. Descriptions are now always empty.
 *   - `fromParsed` printed description AND highlights, so a one-line role the
 *     model put in both came out twice.
 *   - Projects had no bullet list in the schema, only a description, so
 *     bullets were merged into a paragraph and the model chose which to keep.
 *   - Skills were a flat list, so the labels were lost and a vocabulary
 *     regrouped them.
 */

export type ImportAudit = {
    /** Model text the source does not contain. Never stored. */
    rejected: Array<{ where: string; text: string }>;
    /** Source bullets no located entry claimed (a summary in bullets, say). */
    unplaced: string[];
    /** Bullets copied straight from the source. */
    fromSource: number;
};

type Experience = ParsedResumeData['experiences'][number];
type Project = ParsedResumeData['projects'][number];

type Anchor = { kind: 'experience' | 'project' | 'education'; entry: number; line: number };

function lines(text: string | undefined): string[] {
    return (text ?? '')
        .split('\n')
        .map((line) => line.replace(/^[\s•\-*·]+/, '').trim())
        .filter(Boolean);
}

/** Drop a line whose words sit inside another line (the one-line role printed twice). */
export function dedupeContained(items: readonly string[]): string[] {
    const keys = items.map(matchKey);
    return items.filter((item, i) => {
        if (!keys[i]) return false;
        return !keys.some((other, j) => {
            if (j === i || !other.includes(keys[i])) return false;
            return other.length > keys[i].length || j < i;
        });
    });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(text: string): number {
    return MONTHS.indexOf(text.trim().slice(0, 3).toLowerCase());
}

/**
 * "Mar – May 2024" is written with the year once, so the start came through
 * as a bare "Mar": unsortable, and tenure could not count it (e2e QA
 * 2026-11-08). A start with a month and no year takes the end's year, or the
 * year before when the start month is later than the end month
 * ("Nov – Feb 2024" began in Nov 2023). Anything else is left as written.
 */
export function completeStartYear(start: string | null | undefined, end: string | null | undefined): string {
    const startText = (start ?? '').trim();
    if (!startText || /\d{4}/.test(startText)) return startText;
    const startMonth = monthIndex(startText);
    const endYear = (end ?? '').match(/\b(\d{4})\b/)?.[1];
    if (startMonth < 0 || !endYear) return startText;
    const endMonth = monthIndex((end ?? '').replace(/\d{4}/, ''));
    const year = endMonth >= 0 && startMonth > endMonth ? Number(endYear) - 1 : Number(endYear);
    return `${startText} ${year}`;
}

export function reconcileWithSource(
    parsed: ParsedResumeData,
    rawSource: string,
): { data: ParsedResumeData; audit: ImportAudit } {
    const source = normalizeSourceText(rawSource);
    const all = readLines(source);
    const audit: ImportAudit = { rejected: [], unplaced: [], fromSource: 0 };
    const reject = (where: string, text: string) => {
        if (text.trim()) audit.rejected.push({ where, text: collapseWhitespace(text) });
    };

    // ── 1. locate every entry by its name
    const used = new Set<number>();
    const anchors: Anchor[] = [];
    const seenCompanies = new Set<string>();
    parsed.experiences.forEach((experience, entry) => {
        const sections = ['experience', 'other'] as const;
        const companyKey = matchKey(experience.company ?? '');
        const role = (experience.role ?? '').split(' | ')[0];
        // A second role at the same employer is found by its title.
        const order = seenCompanies.has(companyKey) ? [role, experience.company] : [experience.company, role];
        if (companyKey) seenCompanies.add(companyKey);
        for (const needle of order) {
            const line = needle ? locateLine(all, needle, { sections: [...sections], used }) : -1;
            if (line >= 0) {
                used.add(line);
                anchors.push({ kind: 'experience', entry, line });
                return;
            }
        }
    });
    parsed.projects.forEach((project, entry) => {
        const line = locateLine(all, project.name ?? '', { sections: ['projects', 'other', 'experience'], used });
        if (line >= 0) {
            used.add(line);
            anchors.push({ kind: 'project', entry, line });
        }
    });
    parsed.education.forEach((education, entry) => {
        const line = locateLine(all, education.institution ?? '', { sections: ['education', 'other'], used });
        if (line >= 0) {
            used.add(line);
            anchors.push({ kind: 'education', entry, line });
        }
    });

    // ── 2. regions: an anchor up to the next anchor or heading
    const boundaries = [...new Set([...anchors.map((a) => a.line), ...all.filter((l) => l.heading).map((l) => l.index)])].sort(
        (a, b) => a - b,
    );
    const regionEnd = (line: number) => boundaries.find((b) => b > line) ?? all.length;
    const bullets = extractBullets(all, new Set(anchors.map((a) => a.line)));

    const owned = new Map<string, SourceBullet[]>();
    for (const bullet of bullets) {
        const owner = anchors
            .filter((a) => a.line <= bullet.startLine && regionEnd(a.line) > bullet.startLine)
            .sort((a, b) => b.line - a.line)[0];
        if (!owner) {
            audit.unplaced.push(bullet.text);
            continue;
        }
        const key = `${owner.kind}:${owner.entry}`;
        owned.set(key, [...(owned.get(key) ?? []), bullet]);
    }

    const regionOf = (anchor: Anchor | undefined): { text: string; header: SourceLine[]; bullets: SourceBullet[] } => {
        if (!anchor) return { text: source, header: [], bullets: [] };
        const end = regionEnd(anchor.line);
        const region = all.slice(anchor.line, end);
        const mine = owned.get(`${anchor.kind}:${anchor.entry}`) ?? [];
        const firstBullet = mine[0]?.startLine ?? end;
        return {
            text: region.map((line) => line.text).join('\n'),
            header: region.filter((line) => line.index < firstBullet),
            bullets: mine,
        };
    };
    const anchorFor = (kind: Anchor['kind'], entry: number) => anchors.find((a) => a.kind === kind && a.entry === entry);

    /** Lines for a region with no marked bullets: the model's, found and read to the sentence end. */
    const verifiedLines = (where: string, candidates: string[], regionText: string, header: readonly string[]): string[] => {
        const kept: string[] = [];
        for (const candidate of candidates) {
            const span = findSpan(candidate, regionText);
            if (!span) {
                reject(where, candidate);
                continue;
            }
            const line = withoutHeader(extendToSentence(regionText, span), header);
            if (line) kept.push(line);
        }
        return dedupeContained(kept);
    };

    const fromRegion = (
        where: string,
        region: ReturnType<typeof regionOf>,
        candidates: string[],
        header: readonly string[],
    ): string[] => {
        if (region.bullets.length > 0) {
            for (const candidate of candidates) if (!isPresentInSource(candidate, source)) reject(where, candidate);
            audit.fromSource += region.bullets.length;
            return region.bullets.map((bullet) => bullet.text);
        }
        return verifiedLines(where, candidates, region.text, header);
    };

    // ── 3. experiences
    const experiences: Experience[] = [];
    parsed.experiences.forEach((experience, entry) => {
        const where = `experience ${experience.company || experience.role}`;
        const anchor = anchorFor('experience', entry);
        if (!anchor && !isPresentInSource(experience.company ?? '', source) && !isPresentInSource(experience.role ?? '', source)) {
            reject(where, `${experience.role} at ${experience.company}`);
            return;
        }
        const region = regionOf(anchor);
        const [roleOnly, ...stackParts] = (experience.role ?? '').split(' | ');
        const role = roleOnly.trim();
        const headerText = region.header.map((line) => line.text).join('\n');

        const companyNote =
            (anchor ? noteAfter(all[anchor.line].text, experience.company ?? '') : '') ||
            verified(experience.companyNote, headerText);
        const stack =
            region.header.map((line) => stackAfter(line.text, role)).find(Boolean) ||
            verified(stackParts.join(' | ') || experience.stack, headerText);

        const highlights = fromRegion(
            where,
            region,
            [...(experience.highlights ?? []), ...lines(experience.description)],
            [experience.company ?? '', role, experience.location ?? ''],
        );
        experiences.push({
            ...experience,
            startDate: completeStartYear(experience.startDate, experience.endDate),
            role,
            description: '',
            highlights,
            ...(companyNote ? { companyNote } : {}),
            ...(stack ? { stack } : {}),
        });
    });

    // ── 4. projects
    const projects: Project[] = [];
    parsed.projects.forEach((project, entry) => {
        const where = `project ${project.name}`;
        const anchor = anchorFor('project', entry);
        if (!anchor && !isPresentInSource(project.name ?? '', source)) {
            reject(where, project.name ?? '');
            return;
        }
        const region = regionOf(anchor);
        const bulletsOut = fromRegion(where, region, lines(project.description), [project.name ?? '']);
        const headerText = region.header.map((line) => line.text).join('\n');
        // The list printed on the project's own line wins; the model's is
        // kept only where the page has none, and only what the page says.
        const printed = anchor ? technologiesFromHeader(all[anchor.line].text, project.name ?? '') : [];
        const technologies = printed.length > 0
            ? printed
            : (project.technologies ?? []).filter((tech) => {
                const span = findSpan(tech, anchor ? headerText || region.text : source);
                if (!span?.exact) reject(`${where} technologies`, tech);
                return Boolean(span?.exact);
            });
        // The title as printed: "Tonecall: agent-to-agent call protocol", not "Tonecall".
        const printedTitle = anchor ? all[anchor.line].text.split(/\s+[|·]\s+/)[0].trim() : '';
        const name = printedTitle && printedTitle.length <= 120 && (`${matchKey(printedTitle)} `).startsWith(`${matchKey(project.name ?? '')} `)
            ? printedTitle
            : project.name;
        projects.push({ ...project, name, description: bulletsOut.join('\n'), technologies });
    });

    // ── 5. education: keep what names a real institution
    const education = parsed.education.filter((item) => {
        const present = isPresentInSource(item.institution ?? '', source);
        if (!present) reject('education', item.institution ?? '');
        return present;
    });

    // ── 6. skills: the resume's own rows when it has them
    const rows = extractSkillGroups(all);
    let skills: string[];
    let skillGroups: ParsedResumeData['skillGroups'];
    if (rows.length > 0) {
        skillGroups = rows;
        skills = uniqueCaseless(rows.flatMap((row) => row.items));
    } else {
        skills = uniqueCaseless(
            (parsed.skills ?? []).filter((skill) => {
                const span = findSpan(skill, source);
                if (!span?.exact) reject('skills', skill);
                return Boolean(span?.exact);
            }),
        );
        skillGroups = (parsed.skillGroups ?? [])
            .map((group) => ({
                label: findSpan(group.label, source)?.exact ? group.label.trim() : '',
                items: group.items.filter((item) => findSpan(item, source)?.exact),
            }))
            .filter((group) => group.items.length > 0);
    }

    // ── 7. the header block: copied or nothing
    const summary = parsed.personalInfo.summary?.trim() ? verbatimFromSource(parsed.personalInfo.summary, source) : '';
    if (parsed.personalInfo.summary?.trim() && !summary) reject('summary', parsed.personalInfo.summary);
    const title = parsed.personalInfo.title?.trim() && findSpan(parsed.personalInfo.title, source)?.exact
        ? verbatimFromSource(parsed.personalInfo.title, source) ?? ''
        : '';
    if (parsed.personalInfo.title?.trim() && !title) reject('title', parsed.personalInfo.title);

    // ── 8. achievements: their words or nothing
    const achievements = parsed.achievements
        .map((item) => {
            const description = item.description?.trim() ? verbatimFromSource(item.description, source) ?? '' : '';
            if (item.description?.trim() && !description) reject('achievement', item.description);
            const titleOk = isPresentInSource(item.title ?? '', source);
            return titleOk || description ? { ...item, title: titleOk ? item.title : description.slice(0, 120), description } : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
        data: {
            ...parsed,
            personalInfo: { ...parsed.personalInfo, summary: summary ?? '', title },
            experiences,
            projects,
            education,
            achievements,
            skills,
            ...(skillGroups && skillGroups.length > 0 ? { skillGroups } : {}),
        },
        audit,
    };
}

/**
 * A one-line role's sentence without its header: "2Sigma School, SDE Intern.
 * Built …" → "Built …". A leading sentence made only of the entry's own
 * name, title and place is the header, not the bullet; a trailing date range
 * is the dates column. Neither is something the candidate did.
 */
export function withoutHeader(line: string, header: readonly string[]): string {
    const own = new Set(header.flatMap((part) => matchKey(part).split(' ')).filter(Boolean));
    let rest = withoutDateRange(line);
    for (;;) {
        const match = rest.match(/^(.+?[.:;])\s+(?=\S)/);
        if (!match) break;
        const words = matchKey(match[1]).split(' ').filter(Boolean);
        if (words.length === 0 || !words.every((word) => own.has(word))) break;
        rest = rest.slice(match[0].length);
    }
    return rest.trim();
}

/** A model-supplied header fragment, kept only in the source's own words. */
function verified(value: string | undefined, headerText: string): string {
    const text = (value ?? '').trim();
    if (!text || !headerText) return '';
    const span = findSpan(text, headerText);
    return span?.exact ? collapseWhitespace(headerText.slice(span.start, span.end)) : '';
}

function uniqueCaseless(items: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
        const value = item.trim();
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}

const LINK_LABEL = /^(?:repo|code|live|demo|link|github|website|site|paper)$/i;
/** "patronus.cv" printed as a link label. "Next.js" is not a domain. */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cv|com|dev|io|ai|app|org|net|me|co|xyz|sh|so|tech|site|in)$/i;

/** "Voice agent | Python, PyTorch, WebSockets repo" → the list after the name. */
function technologiesFromHeader(line: string, name: string): string[] {
    const [title, list] = line.split(/\s+[|·]\s+/);
    if (!list || !(`${matchKey(title)} `).startsWith(`${matchKey(name)} `)) return [];
    return splitItems(list)
        .map((item) => item.split(' ').filter((word) => !LINK_LABEL.test(word) && !DOMAIN.test(word)).join(' ').trim())
        .filter(Boolean);
}
