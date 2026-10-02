import { prisma } from '@/lib/prisma';
import { externalRetrievalFilter } from '@/lib/graph/visibility';

/**
 * The tools an assembling model may call to see a candidate's record.
 *
 * ── Why these are plain functions ───────────────────────────────────────────
 *
 * Nothing here knows it will be called by a model. Each is an ordinary async
 * function over Prisma, unit-testable without an API key, and the loop wires
 * them up separately. That boundary is what lets us fix a retrieval bug without
 * touching prompt engineering, and vice versa.
 *
 * ── Read-only, always ───────────────────────────────────────────────────────
 *
 * No tool mutates. The model assembles a draft; the single write happens after
 * we have parsed and guarded its output. An assembling model that can also
 * write is a model that can corrupt a record it merely misunderstood.
 *
 * ── Where judgement lives ───────────────────────────────────────────────────
 *
 * The tools do not merely dump rows. `getRoleEvidence` drops the role summary
 * when specifics exist, because feeding both to a writer produced resumes that
 * said the same thing twice per role — once vague, once precise. That is a fact
 * about how this data is SHAPED, not a preference about prose, so it belongs
 * here rather than in a prompt where a model may or may not honour it.
 *
 * The reverse also holds: choosing WHICH roles lead, and which projects earn
 * space, is editorial and stays with the model. Tools return the record
 * faithfully and in a sane order; they do not pre-decide the resume.
 */

export type RoleIndexEntry = {
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    current: boolean;
    location: string;
    /** So the model can budget space before fetching every line. */
    evidenceCount: number;
};

export type RoleEvidence = {
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    current: boolean;
    location: string;
    /** Every usable source line for this role, most specific first. */
    lines: string[];
    /**
     * Present only when the role has no specifics at all. Then the summary IS
     * the evidence and the model must work from it.
     */
    summaryOnly?: string;
};

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
}

/**
 * Sortable key for "Sept 2025", "2020", "Present".
 *
 * Stored dates are free text, so this is deliberately forgiving: pull a year,
 * pull a month name if there is one, and treat a current role as the future.
 * Getting this wrong reorders someone's career, which is the single most
 * visible error a resume can contain — the stored row order is insertion order
 * and cannot be trusted.
 */
const MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

export function dateSortKey(raw: string, current = false): number {
    if (current) return Number.MAX_SAFE_INTEGER;
    const text = (raw || '').trim().toLowerCase();
    if (!text || text === 'present') return Number.MAX_SAFE_INTEGER;

    const year = Number(text.match(/\d{4}/)?.[0] ?? 0);
    const monthIndex = MONTHS.findIndex((month) => text.includes(month));
    return year * 12 + (monthIndex >= 0 ? monthIndex : 0);
}

/**
 * Cheap index of every role. No bullet text.
 *
 * Split from `getRoleEvidence` so the model can see the shape of a career and
 * decide where to spend its budget before pulling every line of every job — on
 * a ten-role history that is the difference between one large prompt and a
 * targeted one.
 *
 * Returned newest-first. See `dateSortKey`.
 */
export async function listRoles(userId: string): Promise<RoleIndexEntry[]> {
    const [rows, winCounts] = await Promise.all([
        prisma.userExperience.findMany({
            where: { userId },
            select: {
                id: true, company: true, role: true, startDate: true,
                endDate: true, current: true, location: true,
                description: true, highlights: true,
            },
        }),
        prisma.win.groupBy({
            by: ['employerId'],
            where: { ...externalRetrievalFilter(userId), employerId: { not: null } },
            _count: { id: true },
        }),
    ]);
    const winsByRole = new Map(winCounts.map((w) => [w.employerId as string, (w._count as { id: number }).id]));

    return rows
        .map((row) => {
            const highlights = asStringArray(row.highlights);
            const description = (row.description || '').trim();
            return {
                id: row.id,
                company: row.company,
                role: row.role,
                startDate: row.startDate,
                endDate: row.endDate,
                current: row.current,
                location: row.location,
                evidenceCount: (highlights.length || (description ? 1 : 0)) + (winsByRole.get(row.id) ?? 0),
            };
        })
        .sort(
            (a, b) =>
                dateSortKey(b.startDate, b.current) - dateSortKey(a.startDate, a.current),
        );
}

/**
 * Every source line for one role.
 *
 * `highlights` are returned and `description` is dropped whenever highlights
 * exist. They are not peers: the description is the summary a user writes first
 * ("Worked on agentic AI support, internal automation, and backend API
 * optimizations") and the highlights are the substance underneath it. Returning
 * both put the summary into selection as a competitor to the lines it
 * summarises, and real resumes came back carrying the same claim twice per
 * role, burning two of roughly fourteen scarce lines to say one thing.
 */
export async function getRoleEvidence(
    userId: string,
    roleId: string,
): Promise<RoleEvidence | null> {
    const row = await prisma.userExperience.findFirst({
        where: { id: roleId, userId },
    });
    if (!row) return null;

    const highlights = asStringArray(row.highlights);
    const description = (row.description || '').trim();
    const winLines = await confirmedWinLines(userId, row.id);

    const base = {
        id: row.id,
        company: row.company,
        role: row.role,
        startDate: row.startDate,
        endDate: row.endDate,
        current: row.current,
        location: row.location,
    };

    if (highlights.length > 0) return { ...base, lines: [...highlights, ...winLines] };
    if (winLines.length > 0) return { ...base, lines: winLines };
    // No specifics anywhere. The summary is all the evidence there is, and
    // saying so explicitly stops the model treating a thin role as a rich one.
    return { ...base, lines: description ? [description] : [], summaryOnly: description || undefined };
}

/** Lines per role a resume can draw from the Work Log. Most recent first. */
const WIN_LINES_PER_ROLE = 12;

/**
 * The user's confirmed Wins at this role, as evidence lines.
 *
 * The Work Log is the product's record of what someone did, and until
 * 2026-10-02 no resume ever read it: confirmed Wins never reached a resume
 * (launch audit). Shareable only, filtered in the query (CLAUDE.md rule 3):
 * a resume is an external artifact, and a confidential Win is never offered
 * to the model at all, so it cannot appear however the prompt is worded.
 */
export async function confirmedWinLines(userId: string, roleId: string): Promise<string[]> {
    const wins = await prisma.win.findMany({
        where: { ...externalRetrievalFilter(userId), employerId: roleId },
        orderBy: { occurredAt: 'desc' },
        take: WIN_LINES_PER_ROLE,
        select: { title: true, narrative: true },
    });
    return wins
        .map((win) => {
            const title = win.title.trim().replace(/[.\s]+$/, '');
            const narrative = win.narrative.trim();
            return narrative && !narrative.toLowerCase().startsWith(title.toLowerCase()) ? `${title}. ${narrative}` : narrative || title;
        })
        .filter(Boolean);
}

export type ProjectEntry = {
    id: string;
    name: string;
    description: string;
    technologies: string[];
    url: string | null;
    githubUrl: string | null;
    /** 'github' means imported, not hand-entered. Useful provenance. */
    source: string | null;
};

/**
 * GitHub language statistics that are not skills.
 *
 * Repo import copies GitHub's detected-language list into `technologies`, and
 * that list counts file types. "Dockerfile" is a filename, "Shell" is whatever
 * .sh files it found, "CSS" appears in any repo with a stylesheet. Printed on a
 * resume they read as padding, and they crowd out the technologies that took
 * skill to use.
 *
 * Filtered here rather than asked for in the prompt, because it was asked for
 * in the prompt and a live run kept "Dockerfile, Shell" anyway. A rule that
 * must hold is code.
 */
const LANGUAGE_STAT_NOISE = new Set([
    'dockerfile', 'makefile', 'batchfile', 'procfile', 'shell', 'css', 'scss',
    'less', 'html', 'roff', 'smarty', 'hcl', 'mdx', 'markdown', 'dotenv',
]);

export function isRealTechnology(raw: string): boolean {
    return Boolean(raw.trim()) && !LANGUAGE_STAT_NOISE.has(raw.trim().toLowerCase());
}

export async function listProjects(userId: string): Promise<ProjectEntry[]> {
    const rows = await prisma.userProject.findMany({
        where: { userId },
        select: {
            id: true, name: true, description: true, technologies: true,
            url: true, githubUrl: true, source: true,
        },
        orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: (row.description || '').trim(),
        technologies: asStringArray(row.technologies).filter(isRealTechnology),
        url: row.url || null,
        githubUrl: row.githubUrl || null,
        source: row.source || null,
    }));
}

export type EducationEntry = {
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
    current: boolean;
};

export async function listEducation(userId: string): Promise<EducationEntry[]> {
    const rows = await prisma.userEducation.findMany({ where: { userId } });
    return rows
        .map((row) => ({
            institution: row.institution,
            degree: row.degree,
            fieldOfStudy: row.fieldOfStudy,
            startDate: row.startDate,
            endDate: row.endDate,
            current: row.current,
        }))
        .sort(
            (a, b) =>
                dateSortKey(b.endDate, b.current) - dateSortKey(a.endDate, a.current),
        );
}

export type ContactCard = {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    defaultTitle: string;
    /** The candidate's own words about themselves. Context, never copy. */
    defaultSummary: string;
    yearsExperience: string;
};

export async function getContactCard(userId: string): Promise<ContactCard | null> {
    const row = await prisma.userProfile.findUnique({ where: { userId } });
    if (!row) return null;
    return {
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        location: row.location,
        website: row.website,
        linkedin: row.linkedin,
        github: row.github,
        defaultTitle: row.defaultTitle,
        defaultSummary: row.defaultSummary,
        yearsExperience: row.yearsExperience,
    };
}

export type SkillEvidence = {
    skill: string;
    /** Where it is demonstrated. A skill with no entry here is not a skill. */
    evidence: string[];
};

/**
 * Skills, each with the line that proves it.
 *
 * Derived from project technologies and the text of role evidence — never from
 * the posting. A resume tool that reads a job ad and adds its requirements to
 * the candidate's skill list is the behaviour this product exists to replace,
 * and the only reliable defence is that the wishlist is never in scope here.
 *
 * The model receives the evidence alongside each skill so it can drop the ones
 * that do not fit the posting, and cannot add ones that were never earned.
 */
export async function getSkillsWithEvidence(userId: string): Promise<SkillEvidence[]> {
    const [projects, roles] = await Promise.all([
        listProjects(userId),
        prisma.userExperience.findMany({
            where: { userId },
            select: { company: true, description: true, highlights: true },
        }),
    ]);

    const byLowercase = new Map<string, SkillEvidence>();

    const add = (skill: string, evidence: string) => {
        const clean = skill.trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        const existing = byLowercase.get(key);
        if (existing) {
            if (!existing.evidence.includes(evidence)) existing.evidence.push(evidence);
            return;
        }
        byLowercase.set(key, { skill: clean, evidence: [evidence] });
    };

    for (const project of projects) {
        for (const tech of project.technologies) add(tech, `Project: ${project.name}`);
    }

    // A technology named inside a role's own lines is evidenced by that role.
    // Matching is on the skill vocabulary we already have from projects, so
    // this widens evidence for known skills rather than inventing new ones from
    // arbitrary prose.
    const vocabulary = [...byLowercase.values()].map((entry) => entry.skill);
    for (const role of roles) {
        const text = [role.description, ...asStringArray(role.highlights)]
            .join(' ')
            .toLowerCase();
        for (const skill of vocabulary) {
            if (text.includes(skill.toLowerCase())) add(skill, `Role: ${role.company}`);
        }
    }

    return [...byLowercase.values()].sort(
        (a, b) => b.evidence.length - a.evidence.length || a.skill.localeCompare(b.skill),
    );
}
