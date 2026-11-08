import { checkNumericGuard } from '@/lib/ai/guard';
import type { ResumeDraft } from '@/lib/ai/resumeLoop';
import type { EducationItem, ExperienceItem, ResumeData } from '@/types/resume';
import type { ContactCard, RecordLines } from '@/lib/resume/tools/evidence';

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
 * ── Why bullets are the record's words (QA 2026-11-07, finding 2) ───────────
 *
 * The model selects and orders; it does not write. A bullet is printed as the
 * record line it came from, whole. Letting the model's `text` through shipped
 * the media-path bullet cut at "…used on 7.5M calls", without "raising
 * concurrent call capacity 2x per machine and cutting fleet infrastructure
 * cost by 50%". A rewrite is used only when the caller says the user asked for
 * one, and even then only if it keeps every figure of the line it rewrites.
 * When the model leaves out a quantified line of a role it kept, the line comes
 * back at the end of that role: space, not the model, decides what is cut (see
 * `pageFit.ts`, which drops the weakest whole bullet).
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

/** What the record holds, for putting the model's choices back into the candidate's words. */
export type DraftRecord = {
    /** Per role id: every line a bullet may come from, and the candidate's own resume lines. */
    roles: ReadonlyMap<string, RecordLines>;
    /** Stored projects. A project imported from a resume is a list of bullet lines. */
    projects: ReadonlyArray<{ name: string; description: string; source?: string | null }>;
};

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

/** Every figure in a line: "7.5M", "2x", "50%", "100K+". */
function figures(text: string): string[] {
    return (text.match(/\d+(?:[.,]\d+)?\s*(?:%|x|k|m|b|ms|s|h)?\+?/gi) ?? []).map((value) => value.toLowerCase().replace(/\s+/g, ''));
}

/**
 * Does a rewrite keep the line's outcome? Every figure of the source must still
 * be in it. "…used on 7.5M calls." keeps one of the three figures of the
 * media-path line, so it fails, and the source line is printed instead.
 */
export function keepsOutcome(rewrite: string, source: string): boolean {
    const have = new Set(figures(rewrite));
    return figures(source).every((figure) => have.has(figure));
}

/** The record line a bullet came from: the one containing its sourceLine (or text). */
export function recordLineFor(bullet: { text: string; sourceLine: string }, lines: readonly string[]): string | null {
    const source = normalizeForMatch(bullet.sourceLine);
    const text = normalizeForMatch(bullet.text);
    if (!source && !text) return null;
    const found =
        lines.find((line) => normalizeForMatch(line) === source) ??
        lines.find((line) => source.length >= 12 && normalizeForMatch(line).includes(source)) ??
        lines.find((line) => {
            const key = normalizeForMatch(line);
            // The model joined a record line split across two highlights.
            return key.length >= 24 && source.includes(key);
        }) ??
        lines.find((line) => text.length >= 12 && normalizeForMatch(line).includes(text));
    return found ?? null;
}

type Kept = { text: string; sourceLine: string };

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
    options: { record?: RecordLines; allowRewrite: boolean; maxBullets?: number },
): { kept: Kept[]; violations: string[] } {
    const kept: Kept[] = [];
    const violations: string[] = [];
    const used = new Set<string>();
    const { record, allowRewrite } = options;

    for (const bullet of bullets) {
        if (!sourceWasSeen(bullet.sourceLine, evidenceSeen)) {
            violations.push(`"${bullet.text.slice(0, 80)}" — cites a source line the record does not contain`);
            continue;
        }

        // The record's whole line, so a clause the model cut comes back.
        const line = record ? recordLineFor(bullet, record.lines) : bullet.sourceLine.trim();
        if (!line) {
            violations.push(`"${bullet.text.slice(0, 80)}" — cites a line this role does not hold`);
            continue;
        }
        const key = normalizeForMatch(line);
        if (used.has(key)) continue;

        let text = line;
        if (allowRewrite && bullet.text.trim() && keepsOutcome(bullet.text, line)) {
            const guarded = checkNumericGuard({ text: bullet.text }, { sourceText: line, fields: ['text'] });
            if (guarded.violations.length === 0) text = bullet.text.trim();
        }
        used.add(key);
        kept.push({ text, sourceLine: line });
    }

    // A quantified line of a role the model kept, left out: put it back last.
    // It is the first experience line `pageFit` cuts if the page runs over.
    if (record && kept.length > 0) {
        const cap = options.maxBullets ?? Number.POSITIVE_INFINITY;
        for (const line of record.restorable) {
            if (kept.length >= cap) break;
            const key = normalizeForMatch(line);
            if (used.has(key) || figures(line).length === 0) continue;
            used.add(key);
            kept.push({ text: line, sourceLine: line });
        }
    }

    return { kept, violations };
}

// ───────────────────────────────────────────────────────────── projects

function recordProjectFor(name: string, record: DraftRecord | undefined) {
    if (!record) return null;
    const key = normalizeForMatch(name);
    if (!key) return null;
    return (
        record.projects.find((project) => normalizeForMatch(project.name) === key) ??
        record.projects.find((project) => {
            const other = normalizeForMatch(project.name);
            return other.length > 0 && (other.startsWith(`${key} `) || key.startsWith(`${other} `));
        }) ??
        null
    );
}

function lineList(description: string): string[] {
    return description
        .split('\n')
        .map((line) => line.replace(/^[\s•\-*·]+/, '').trim())
        .filter(Boolean);
}

/** A stored description that is resume bullets (one per line), not an imported README. */
function isBulletList(project: { description: string; source?: string | null }): boolean {
    const lines = lineList(project.description);
    if (lines.length === 0 || project.source === 'github') return false;
    return lines.every((line) => line.length <= 600) && (lines.length >= 2 || project.source === 'pdf_resume' || lines[0].length <= 400);
}

const wordsOf = (text: string) => new Set(normalizeForMatch(text).split(' ').filter((word) => word.length >= 3));

/**
 * A project from a resume prints its own bullet lines, verbatim. The lines the
 * model's description draws on come first, then the rest; `pageFit` cuts from
 * the end. The model's prose is kept only for a README-style description, where
 * writing is the point, or when the user asked for rewrites.
 */
function projectBullets(modelDescription: string, recordDescription: string): string {
    const lines = lineList(recordDescription);
    const said = wordsOf(modelDescription);
    const score = (line: string) => {
        const words = [...wordsOf(line)];
        return words.length === 0 ? 0 : words.filter((word) => said.has(word)).length / words.length;
    };
    const chosen = lines.filter((line) => score(line) >= 0.5);
    const rest = lines.filter((line) => !chosen.includes(line));
    return [...chosen, ...rest].join('\n');
}

// ───────────────────────────────────────────────────────────── the About line

/**
 * Words that make an About line filler. The audit's: "AI-focused software
 * engineer with engineering experience spanning…". A summary with any of these
 * is replaced by one built from the record.
 */
const FILLER = [
    /\bspanning\b/i, /\bleverag(?:e|es|ed|ing)\b/i, /\bpassionate\b/i, /\bresults?[- ](?:driven|oriented)\b/i,
    /\bdetail[- ]oriented\b/i, /\bself[- ]starter\b/i, /\bgo[- ]getter\b/i, /\bsynerg/i, /\bdynamic\b/i,
    /\bseasoned\b/i, /\btrack record\b/i, /\bcutting[- ]edge\b/i, /\binnovative\b/i, /\bteam player\b/i,
    /\bhard[- ]?working\b/i, /\bmotivated\b/i, /\bdedicated\b/i, /\benthusias/i, /\bthought leader/i,
    /\bworld[- ]class\b/i, /\bbest[- ]in[- ]class\b/i, /\bextensive experience\b/i, /\bwide (?:range|variety)\b/i,
    /\bdiverse\b/i, /\bvarious\b/i, /\badept\b/i, /\bversatile\b/i, /\bexpertise in\b/i, /\bproficient\b/i,
    /\w-focused\b/i, /\bwith (?:engineering |hands-on |proven )?experience (?:in|across|with)\b/i,
    /\b(?:strong|solid|deep) (?:background|expertise)\b/i, /\bhigh[- ]quality\b/i, /\bexcellence\b/i,
];
const MAX_SUMMARY_WORDS = 40;

export function isFillerSummary(summary: string): boolean {
    return FILLER.some((pattern) => pattern.test(summary));
}

/**
 * Is every specific term in the summary in the record? Capitalised words that
 * do not start a sentence, and anything with a digit, are the claims; each must
 * appear in what the tools returned.
 */
function termsAreSourced(summary: string, evidenceSeen: string): boolean {
    const evidence = ` ${normalizeForMatch(evidenceSeen)} `;
    for (const sentence of summary.split(/(?<=[.!?])\s+/)) {
        for (const raw of sentence.split(/\s+/).slice(1)) {
            const word = raw.replace(/^[^\w]+|[^\w+#%]+$/g, '');
            if (!word || !(/[A-Z]/.test(word) || /\d/.test(word))) continue;
            if (!evidence.includes(` ${normalizeForMatch(word)} `)) return false;
        }
    }
    return true;
}

/** "Software Engineer I at Plivo (Go, C, Python), previously at Hyperbots. B.Tech, IIT Delhi." */
export function factSummary(experience: readonly ExperienceItem[], education: readonly EducationItem[]): string {
    const [first, second] = experience;
    if (!first) return '';
    const parts = [`${first.role} at ${first.company}${first.stack?.trim() ? ` (${first.stack.trim()})` : ''}`];
    if (second && normalizeForMatch(second.company) !== normalizeForMatch(first.company)) {
        parts.push(`previously ${normalizeForMatch(second.role) === normalizeForMatch(first.role) ? '' : `${second.role} `}at ${second.company}`);
    }
    let summary = `${parts.join(', ')}.`;
    const school = education[0];
    if (school?.institution && school.degree) {
        summary += ` ${school.degree}${school.fieldOfStudy ? ` in ${school.fieldOfStudy}` : ''}, ${school.institution}.`;
    }
    return summary.replace(/\s+/g, ' ').trim();
}

/**
 * The About line: the model's, when it is short, specific and sourced;
 * otherwise one built from the record. Never filler.
 */
export function chooseSummary(params: {
    draftSummary: string;
    evidenceSeen: string;
    experience: readonly ExperienceItem[];
    education: readonly EducationItem[];
}): { summary: string; replaced: boolean } {
    const draft = params.draftSummary.replace(/\s+/g, ' ').trim();
    const words = draft ? draft.split(' ').length : 0;
    const sentences = draft ? draft.split(/(?<=[.!?])\s+/).length : 0;
    const usable =
        draft.length > 0 &&
        words <= MAX_SUMMARY_WORDS &&
        sentences <= 2 &&
        !isFillerSummary(draft) &&
        termsAreSourced(draft, params.evidenceSeen);
    if (usable) return { summary: draft, replaced: false };
    return { summary: factSummary(params.experience, params.education), replaced: draft.length > 0 };
}

// ───────────────────────────────────────────────────────────── the document

function sameRole(a: { company: string; role: string }, b: { company: string; role: string }): boolean {
    return normalizeForMatch(a.company) === normalizeForMatch(b.company) && normalizeForMatch(a.role) === normalizeForMatch(b.role);
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
    /** The record, so bullets print in the candidate's words. Absent: the source lines as cited. */
    record?: DraftRecord;
    /**
     * The resume this is tailored from. Carries what history has no column for:
     * a company's tag line, a role's stack, and the candidate's skills rows.
     */
    base?: Pick<ResumeData, 'experience' | 'skillGroups'> | null;
    /** True only when the user asked for rewording. Default: the record's lines, verbatim. */
    allowRewrite?: boolean;
    /** Upper bound per role when putting back a quantified line the model left out. */
    maxBulletsPerRole?: number;
}): DraftCheck {
    const { draft, contact, availableRoles, evidenceSeen, record, base } = params;
    const allowRewrite = params.allowRewrite ?? false;
    const sectionOrder =
        params.sectionOrder?.length
            ? params.sectionOrder
            : (['summary', 'experience', 'projects', 'education', 'skills'] as const);
    const shows = (section: ResumeData['sectionOrder'][number]) =>
        sectionOrder.includes(section);

    const allViolations: string[] = [];
    const experience: ExperienceItem[] = draft.experience
        .map((role) => {
            const { kept, violations } = guardBullets(role.bullets, evidenceSeen, {
                record: record?.roles.get(role.roleId),
                allowRewrite,
                maxBullets: params.maxBulletsPerRole,
            });
            allViolations.push(...violations);
            return { role, description: joinBullets(kept) };
        })
        // A role whose every line failed the guard is not a role. Printing the
        // heading with no content underneath looks like a rendering bug and
        // silently tells the reader nothing.
        .filter((entry) => entry.description.length > 0)
        .map(({ role, description }) => {
            const from = base?.experience.find((item) => sameRole(item, role));
            return {
                id: role.roleId,
                company: role.company,
                role: role.role,
                startDate: role.startDate,
                endDate: role.endDate,
                current: /present|current/i.test(role.endDate),
                location: role.location,
                description,
                ...(from?.companyNote?.trim() ? { companyNote: from.companyNote.trim() } : {}),
                ...(from?.stack?.trim() ? { stack: from.stack.trim() } : {}),
            };
        });

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

    const education = !shows('education') ? [] : draft.education.map((entry, index) => ({
        id: `e${index}`,
        institution: entry.institution,
        degree: entry.degree,
        fieldOfStudy: entry.fieldOfStudy,
        startDate: entry.startDate,
        endDate: entry.endDate,
        current: false,
    }));

    // Filler, unsourced or over-long, the model's About is replaced by facts.
    const about = chooseSummary({
        draftSummary: badProse.has('summary') ? '' : draft.summary,
        evidenceSeen,
        experience,
        education,
    });
    if (about.replaced) allViolations.push('summary — filler or unsourced; built from the record instead');

    const projects = !shows('projects') ? [] : draft.projects.map((project, index) => {
        const stored = recordProjectFor(project.name, record);
        const modelText = badProse.has(`projects.${index}.description`) ? '' : project.description;
        const description = stored && isBulletList(stored) && !allowRewrite
            ? projectBullets(project.description, stored.description)
            : modelText;
        return {
            id: `p${index}`,
            name: project.name,
            description,
            url: project.url,
            liveUrl: '',
            repoUrl: project.url,
            technologies: project.technologies,
        };
    });

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
            summary: shows('summary') ? about.summary : '',
        },
        experience,
        // A section the user removed is not merely unordered, it is absent.
        // Emitting the content and relying on the renderer to skip it means the
        // data is still in the stored resume and still in any export that
        // ignores sectionOrder.
        projects,
        education,
        // Groups are flattened for storage. The candidate's own rows travel
        // from the base resume, and the renderer prints only the skills kept.
        skills: !shows('skills') ? [] : draft.skills.flatMap((group) => group.items),
        ...(shows('skills') && base?.skillGroups?.length ? { skillGroups: base.skillGroups } : {}),
        sectionOrder: [...sectionOrder],
    } as ResumeData;

    return { ok: true, resume, violations: allViolations };
}
