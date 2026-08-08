/**
 * Resume generation v2 — the whole sequence, in the order a person works.
 *
 *   read the posting  →  score every line  →  select what earns space
 *                     →  write the survivors  →  choose skills on evidence
 *                     →  write the summary last  →  score by what it answers
 *
 * The old pipeline had steps too, but they were plumbing steps — parse,
 * retrieve, paraphrase, assemble. The one thing it never did was DECIDE, and
 * deciding is most of what resume writing is. That gap is why the 7 Aug audit
 * resume dropped "Mentored 3 engineers" from an application whose posting says
 * "Mentor engineers and raise the technical bar".
 *
 * Four properties hold by construction here, not by prompt:
 *
 *   No skill ships without evidence — `chooseSkills` has no code path for it.
 *   No figure appears that is not in the candidate's own text — the numeric
 *     guard runs on every writing call with their words as the source.
 *   A bullet answering a stated must-have cannot be truncated away — selection
 *     covers before it fills.
 *   The score falls when the resume gets worse — it counts answered
 *     requirements, so losing the evidence loses the points.
 */

import type { EducationItem, ExperienceItem, ProjectItem, ResumeData } from '@/types/resume';
import { MAX_SKILLS } from '@/lib/resumeNormalizer';

import { readPosting, type PostingBrief } from './posting';
import { scoreBullets, selectBullets, keptForGroup, type SourceBullet } from './select';
import { writeBullets, writeSummary, chooseTitle } from './write';
import { chooseSkills } from './skills';
import { computeCoverage, gapAdvice, type CoverageReport } from './coverage';

export type TailorInput = {
    jobDescription: string;
    profile: {
        fullName: string;
        title: string;
        email: string;
        phone: string;
        location: string;
        website: string;
        linkedin: string;
        github: string;
        summary: string;
    };
    experiences: ExperienceItem[];
    projects: ProjectItem[];
    education: EducationItem[];
    /** Skills drawn from the candidate's own history, before evidence gating. */
    candidateSkills: string[];
    sectionOrder: ResumeData['sectionOrder'];
    caps?: { maxBulletsPerRole?: number; maxRoles?: number; maxSkills?: number };
    userId: string;
    sessionId?: string;
};

export type TailorResult = {
    resume: ResumeData;
    brief: PostingBrief;
    coverage: CoverageReport;
    /** Wanted by the posting, unevidenced, therefore not on the resume. */
    skillGaps: string[];
    /** Plain sentences for the editor. Empty when nothing is missing. */
    advice: string[];
    /**
     * Lines that did not make the page, with why — and WHERE they came from,
     * so the editor can offer to put one back rather than only mourn it.
     * `targetId` is the real experience/project row id, not the internal
     * group index.
     */
    dropped: Array<{
        id: string;
        text: string;
        reason: 'cap' | 'weak';
        targetId: string;
        targetKind: 'experience' | 'project';
        targetLabel: string;
    }>;
};

const DEFAULT_CAPS = { maxBulletsPerRole: 4, maxRoles: 4 };

/**
 * Group id for education and skills.
 *
 * They are scored like bullets so the same model call decides what they
 * answer, and excluded from selection because they are not bullets — they
 * already have their own sections on the page.
 */
const CREDENTIAL_GROUP = 'cred';

/** Split a description into its individual lines, which are the real unit. */
function toBullets(text: string, groupId: string): SourceBullet[] {
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .flatMap((line) => line.split(/[•●]/g))
        .map((line) => line.replace(/^\s*[-*]+\s*/, '').trim())
        .filter((line) => line.length > 0)
        .map((line, index) => ({ id: `${groupId}:${index}`, groupId, text: line }));
}

/** Years between the earliest listed role and now. */
function tenureYears(experiences: readonly ExperienceItem[]): number {
    const years = experiences
        .map((item) => Number.parseInt(item.startDate.slice(0, 4), 10))
        .filter((year) => Number.isFinite(year) && year > 1950);
    if (years.length === 0) return 0;
    return Math.max(0, new Date().getUTCFullYear() - Math.min(...years));
}

function yearsHint(experiences: readonly ExperienceItem[]): string {
    const span = tenureYears(experiences);
    return span >= 1 ? `about ${span} years since their first listed role` : '';
}

export async function tailorResume(input: TailorInput): Promise<TailorResult> {
    const caps = {
        maxPerGroup: input.caps?.maxBulletsPerRole ?? DEFAULT_CAPS.maxBulletsPerRole,
        maxGroups: input.caps?.maxRoles ?? DEFAULT_CAPS.maxRoles,
    };
    const maxSkills = input.caps?.maxSkills ?? MAX_SKILLS;

    // ── 1. read the posting
    const { brief } = await readPosting({
        jobDescription: input.jobDescription,
        userId: input.userId,
        sessionId: input.sessionId,
    });

    // ── 2. every line the candidate has, as individual claims
    const groups = new Map<
        string,
        { label: string; kind: 'experience' | 'project'; rowId: string }
    >();
    const bullets: SourceBullet[] = [];

    input.experiences.forEach((item, index) => {
        const groupId = `e${index}`;
        groups.set(groupId, {
            label: `${item.role} at ${item.company}`,
            kind: 'experience',
            rowId: item.id,
        });
        bullets.push(...toBullets(item.description, groupId));
    });
    input.projects.forEach((item, index) => {
        const groupId = `p${index}`;
        groups.set(groupId, { label: item.name, kind: 'project', rowId: item.id });
        bullets.push(...toBullets(item.description, groupId));
    });

    // Education and the candidate's own skills are ON the resume and can
    // answer a requirement, so they are scored alongside the bullets — but in
    // their own group, which selection never sees. Without this, coverage read
    // bullets only and told a career switcher holding a BS that nothing on her
    // resume answered "Bachelor's degree in any field", and that she lacked
    // "Working knowledge of SQL" while SQL sat in the skills section of the
    // document being scored.
    const credentialSources: SourceBullet[] = [
        ...input.education.map((item, index) => ({
            id: `${CREDENTIAL_GROUP}:edu${index}`,
            groupId: CREDENTIAL_GROUP,
            text: [item.degree, item.fieldOfStudy, item.institution, item.endDate]
                .map((part) => (part ?? '').trim())
                .filter(Boolean)
                .join(', '),
        })),
        ...(input.candidateSkills.length > 0
            ? [
                  {
                      id: `${CREDENTIAL_GROUP}:skills`,
                      groupId: CREDENTIAL_GROUP,
                      text: `Skills listed on the resume: ${input.candidateSkills.join(', ')}`,
                  },
              ]
            : []),
    ].filter((entry) => entry.text.trim().length > 0);

    const scoredAll = await scoreBullets({
        bullets: [...bullets, ...credentialSources],
        brief,
        userId: input.userId,
        sessionId: input.sessionId,
    });

    const credentials = scoredAll.filter((entry) => entry.groupId === CREDENTIAL_GROUP);
    const scored = scoredAll.filter((entry) => entry.groupId !== CREDENTIAL_GROUP);

    // ── 3. decide what earns space
    const selection = selectBullets(scored, brief.requirements, caps);

    // ── 4. write the survivors, one role at a time
    const groupIds = [...new Set(selection.kept.map((bullet) => bullet.groupId))];
    const written = await Promise.all(
        groupIds.map(async (groupId) => ({
            groupId,
            bullets: await writeBullets({
                groupLabel: groups.get(groupId)?.label ?? groupId,
                bullets: keptForGroup(selection, groupId),
                brief,
                userId: input.userId,
                sessionId: input.sessionId,
            }),
        })),
    );
    const textByGroup = new Map(
        written.map((entry) => [entry.groupId, entry.bullets.map((b) => b.text)]),
    );

    // ── 5. skills, gated on evidence
    const corpus = [
        ...bullets.map((b) => b.text),
        ...input.projects.flatMap((p) => [p.name, ...(p.technologies ?? [])]),
        input.profile.summary,
        input.profile.title,
    ].join('\n');

    const { skills, gaps: skillGaps } = chooseSkills({
        wanted: brief.skills,
        corpus,
        candidateSkills: input.candidateSkills,
        max: maxSkills,
    });

    // ── 6. the summary, written from the document that now exists
    const allWritten = written.flatMap((entry) => entry.bullets);
    const summary = await writeSummary({
        currentTitle: input.profile.title || input.experiences[0]?.role || '',
        yearsHint: yearsHint(input.experiences),
        bullets: allWritten,
        brief,
        // Skills are chosen BEFORE the summary precisely so this list exists.
        forbiddenTerms: skillGaps,
        userId: input.userId,
        sessionId: input.sessionId,
    });

    // ── 7. assemble, keeping only what earned a place
    const experience = input.experiences
        .map((item, index) => ({ item, groupId: `e${index}` }))
        .filter(({ groupId }) => textByGroup.has(groupId))
        .map(({ item, groupId }) => ({
            ...item,
            description: (textByGroup.get(groupId) ?? []).join('\n'),
        }));

    const projects = input.projects
        .map((item, index) => ({ item, groupId: `p${index}` }))
        .filter(({ groupId }) => textByGroup.has(groupId))
        .map(({ item, groupId }) => ({
            ...item,
            description: (textByGroup.get(groupId) ?? []).join('\n'),
        }));

    const resume: ResumeData = {
        personalInfo: {
            ...input.profile,
            title: chooseTitle({ candidateTitle: input.profile.title, postingRole: brief.role }),
            summary,
        },
        experience,
        projects,
        education: input.education,
        skills,
        sectionOrder: input.sectionOrder,
    };

    // ── 8. score by what it answers
    //
    // All three evidence sources, not just the bullets that survived the cap.
    // Coverage used to run on `selection.kept` alone, computed AFTER the
    // four-per-role cap — so a line the candidate wrote, which answers a
    // stated must, and which we removed for space, was indistinguishable from
    // a line that never existed. That is how a marketer whose history says
    // "Manage a team of three and a £1.2M annual budget" was told nothing on
    // her resume answered "Experience managing and developing marketers".
    const coverage = computeCoverage(
        brief.requirements,
        {
            kept: selection.kept,
            cut: selection.dropped.map((entry) => entry.bullet),
            credentials,
        },
        tenureYears(input.experiences),
    );

    return {
        resume,
        brief,
        coverage,
        skillGaps,
        advice: gapAdvice(coverage, skillGaps),
        // Surfaced so the editor can offer a swap. A line the candidate wrote
        // and we chose not to use is information they are entitled to.
        dropped: selection.dropped.map(({ bullet, reason }) => {
            const group = groups.get(bullet.groupId);
            return {
                id: bullet.id,
                text: bullet.text,
                reason,
                targetId: group?.rowId ?? '',
                targetKind: group?.kind ?? 'experience',
                targetLabel: group?.label ?? '',
            };
        }),
    };
}
