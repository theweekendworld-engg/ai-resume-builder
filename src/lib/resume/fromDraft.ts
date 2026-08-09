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
    | { ok: true; resume: ResumeData }
    | { ok: false; reason: DraftRejection };

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
): { kept: typeof bullets; violations: string[] } {
    const kept: { text: string; sourceLine: string }[] = [];
    const violations: string[] = [];

    for (const bullet of bullets) {
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
}): DraftCheck {
    const { draft, contact, availableRoles } = params;

    const allViolations: string[] = [];
    const experience = draft.experience
        .map((role) => {
            const { kept, violations } = guardBullets(role.bullets);
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

    // Fabrication is reported even when the document survives, because the rate
    // is the number that matters — a guard that silently drops bad lines looks
    // identical to a model that never writes them, and only one of those is
    // worth shipping.
    if (allViolations.length > 0) {
        return {
            ok: false,
            reason: {
                kind: 'fabrication',
                detail: `${allViolations.length} bullet(s) carried a figure their stated source does not contain.`,
                violations: allViolations,
            },
        };
    }

    const resume: ResumeData = {
        personalInfo: {
            fullName: contact?.fullName ?? '',
            title: draft.headline || contact?.defaultTitle || '',
            email: contact?.email ?? '',
            phone: contact?.phone ?? '',
            location: contact?.location ?? '',
            website: contact?.website ?? '',
            linkedin: contact?.linkedin ?? '',
            github: contact?.github ?? '',
            summary: draft.summary,
        },
        experience,
        projects: draft.projects.map((project, index) => ({
            id: `p${index}`,
            name: project.name,
            description: project.description,
            url: project.url,
            liveUrl: '',
            repoUrl: project.url,
            technologies: project.technologies,
        })),
        education: draft.education.map((entry, index) => ({
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
        skills: draft.skills.flatMap((group) => group.items),
        sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
    } as ResumeData;

    return { ok: true, resume };
}
