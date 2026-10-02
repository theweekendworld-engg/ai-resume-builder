import { checkNumericGuard } from '@/lib/ai/guard';
import type { ResumeDraft } from '@/lib/ai/resumeLoop';
import type { ResumeData } from '@/types/resume';
import type { ContactCard } from '@/lib/resume/tools/evidence';

/**
 * Turning an assembled draft into a resume, or refusing to.
 *
 * ── Why this is a separate, pure module ─────────────────────────────────────
 *
 * The loop is the only part that needs a model. Everything after it — checking
 * the numbers, flattening to `ResumeData`, deciding whether the draft is fit to
 * store — is deterministic, and keeping it here means it can be tested against
 * hand-written drafts with no API key and no network.
 *
 * ── Why the guard source is per-bullet ──────────────────────────────────────
 *
 * The old pipeline guarded bullets against a separately-assembled source
 * string, which is a weaker check than it looks: a figure invented for role A
 * passes if role B happens to mention it. The loop makes every bullet carry the
 * exact `sourceLine` it came from, so each is checked against its own claimed
 * origin. Borrowing another role's number is now a violation, not a loophole.
 *
 * ── Why an empty draft is an error, not a result ────────────────────────────
 *
 * A generation that returns a structurally valid document with no roles is the
 * failure that shipped blank resumes over working ones. "It did not throw" was
 * never evidence that it worked.
 */

export type DraftRejection =
    | { kind: 'empty'; detail: string }
    | { kind: 'fabrication'; detail: string; violations: string[] };

export type DraftCheck =
    /** `violations`: lines dropped for a figure or source the record does not hold. Report the rate. */
    | { ok: true; resume: ResumeData; violations: string[] }
    | { ok: false; reason: DraftRejection };

/** Case, spacing and punctuation-insensitive, so a line copied verbatim always matches. */
export function normalizeForMatch(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9%$.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Did the model actually see this line? A `sourceLine` is the model's claim
 * about where a bullet came from; trusted as written, it let a bullet cite an
 * invented source and pass the numeric guard against its own invention
 * (launch audit 2026-10-02). It must appear in what the tools returned.
 */
export function sourceWasSeen(sourceLine: string, evidenceSeen: string): boolean {
    const line = normalizeForMatch(sourceLine);
    return line.length > 0 && normalizeForMatch(evidenceSeen).includes(line);
}

/** Bullets are stored as one newline-joined string per role. */
function joinBullets(bullets: readonly { text: string }[]): string {
    return bullets.map((bullet) => bullet.text.trim()).filter(Boolean).join('\n');
}

/**
 * Check every bullet against the line the model said it came from.
 *
 * Returns the bullets that survive. A violation removes that bullet rather than
 * failing the whole document: one over-reaching line should not cost a
 * candidate the other thirteen, and a role that loses all of its bullets is
 * caught by the emptiness check below.
 */
function guardBullets(
    bullets: readonly { text: string; sourceLine: string }[],
    evidenceSeen: string,
): { kept: typeof bullets; violations: string[] } {
    const kept: { text: string; sourceLine: string }[] = [];
    const violations: string[] = [];

    for (const bullet of bullets) {
        if (!sourceWasSeen(bullet.sourceLine, evidenceSeen)) {
            violations.push(`"${bullet.text.slice(0, 80)}" — cites a source line the record does not contain`);
            continue;
        }
        const result = checkNumericGuard(
            { text: bullet.text },
            { sourceText: bullet.sourceLine, fields: ['text'] },
        );
        if (result.violations.length === 0) {
            kept.push(bullet);
            continue;
        }
        violations.push(
            `"${bullet.text.slice(0, 80)}" — figure absent from its stated source`,
        );
    }

    return { kept, violations };
}

export function resumeFromDraft(params: {
    draft: ResumeDraft;
    contact: ContactCard | null;
    /** How many roles the record actually holds. An empty draft over a full record is a failure. */
    availableRoles: number;
    /** Everything the tools returned to the model: the only text any line may come from. */
    evidenceSeen: string;
    /**
     * The user's chosen sections, in their order. Absence from this list means
     * "do not print this section at all" — it is how someone removes projects
     * or a summary from every resume they generate.
     *
     * This was hardcoded, which silently overrode the preference on every
     * generation: a user who had turned the summary off in onboarding got one
     * anyway, and had no way to tell why.
     */
    sectionOrder?: ResumeData['sectionOrder'];
}): DraftCheck {
    const { draft, contact, availableRoles, evidenceSeen } = params;
    const sectionOrder =
        params.sectionOrder?.length
            ? params.sectionOrder
            : (['summary', 'experience', 'projects', 'education', 'skills'] as const);
    const shows = (section: ResumeData['sectionOrder'][number]) =>
        sectionOrder.includes(section);

    const allViolations: string[] = [];
    const experience = draft.experience
        .map((role) => {
            const { kept, violations } = guardBullets(role.bullets, evidenceSeen);
            allViolations.push(...violations);
            return { role, description: joinBullets(kept) };
        })
        // A role whose every line failed the guard is not a role. Printing the
        // heading with no content underneath looks like a rendering bug and
        // silently tells the reader nothing.
        .filter((entry) => entry.description.length > 0)
        .map(({ role, description }) => ({
            id: role.roleId,
            company: role.company,
            role: role.role,
            startDate: role.startDate,
            endDate: role.endDate,
            current: /present|current/i.test(role.endDate),
            location: role.location,
            description,
        }));

    if (availableRoles > 0 && experience.length === 0) {
        return {
            ok: false,
            reason: {
                kind: 'empty',
                detail: `Assembly produced no usable roles from ${availableRoles} in the record.`,
            },
        };
    }

    // A bad line is dropped, not the whole resume: failing here handed the
    // user to the v1 path, which is weaker on truth, for one over-reaching
    // bullet (audit 2026-10-02). The violations come back so callers can
    // report the rate: a guard that silently drops looks identical to a model
    // that never fabricates, and only one of those is worth shipping.

    // The free-text fields carry no source line, so they are checked against
    // everything the model saw. A figure found nowhere in the record is removed.
    const prose = checkNumericGuard(
        {
            headline: draft.headline,
            summary: draft.summary,
            projects: draft.projects.map((project) => ({ description: project.description })),
        },
        {
            sourceText: evidenceSeen,
            fields: ['headline', 'summary', ...draft.projects.map((_, i) => `projects.${i}.description`)],
        },
    );
    const badProse = new Set(prose.violations.map((v) => v.path));
    for (const path of badProse) allViolations.push(`${path} — figure absent from the record`);
    const headline = badProse.has('headline') ? '' : draft.headline;
    const summary = badProse.has('summary') ? '' : draft.summary;

    const resume: ResumeData = {
        personalInfo: {
            fullName: contact?.fullName ?? '',
            title: headline || contact?.defaultTitle || '',
            email: contact?.email ?? '',
            phone: contact?.phone ?? '',
            location: contact?.location ?? '',
            website: contact?.website ?? '',
            linkedin: contact?.linkedin ?? '',
            github: contact?.github ?? '',
            summary: shows('summary') ? summary : '',
        },
        experience,
        // A section the user removed is not merely unordered, it is absent.
        // Emitting the content and relying on the renderer to skip it means the
        // data is still in the stored resume and still in any export that
        // ignores sectionOrder.
        projects: !shows('projects') ? [] : draft.projects.map((project, index) => ({
            id: `p${index}`,
            name: project.name,
            description: badProse.has(`projects.${index}.description`) ? '' : project.description,
            url: project.url,
            liveUrl: '',
            repoUrl: project.url,
            technologies: project.technologies,
        })),
        education: !shows('education') ? [] : draft.education.map((entry, index) => ({
            id: `e${index}`,
            institution: entry.institution,
            degree: entry.degree,
            fieldOfStudy: entry.fieldOfStudy,
            startDate: entry.startDate,
            endDate: entry.endDate,
            current: false,
        })),
        // Groups are flattened for storage; the renderer regroups. Keeping the
        // grouping here would mean a schema migration for a presentation choice.
        skills: !shows('skills') ? [] : draft.skills.flatMap((group) => group.items),
        sectionOrder: [...sectionOrder],
    } as ResumeData;

    return { ok: true, resume, violations: allViolations };
}
