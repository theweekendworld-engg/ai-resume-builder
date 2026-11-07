import type { ResumeData } from '@/types/resume';
import { resolveSkillGroups } from './skillGroups';

/**
 * Make the compiled PDF fit the page budget, or say that it does not.
 *
 * ── Why this exists (QA 2026-11-07, finding 2) ──────────────────────────────
 *
 * Generation compiled the resume once and stored whatever came out. The
 * owner's tailored resume came back two pages long, and nothing anywhere said
 * so: the only length check was a character-count estimate in the editor.
 *
 * Now the real PDF is measured. Over budget, the document is trimmed in a
 * fixed order, recompiled, and measured again, a bounded number of times:
 *
 *   1. the lowest-relevance project bullet (the last line of the last project
 *      that still has more than one)
 *   2. a whole project (the last)
 *   3. the About line
 *   4. a skills row (the last)
 *   5. the lowest-relevance experience bullet (the last line of the role with
 *      the most lines, never below two per role)
 *
 * Whole lines only. Order within a section is relevance order (tailoring
 * prints the model's picks first and restored lines last), so "last" is
 * "weakest". If it still does not fit, the status says `over` and the caller
 * shows it: never two pages shipped silently.
 *
 * Pure apart from the injected compile and measure, so it is tested with
 * fakes for both.
 */

export type PageFitStatus = 'fits' | 'trimmed' | 'over' | 'unchecked';

export type TrimKind = 'project_bullet' | 'project' | 'summary' | 'skills_row' | 'experience_bullet';

export type TrimmedItem = {
    kind: TrimKind;
    text: string;
    /** The row it came from, so the editor can offer it back. */
    targetId?: string;
    targetKind?: 'experience' | 'project';
    targetLabel?: string;
};

export type PageFit = {
    status: PageFitStatus;
    /** Pages of the PDF that was kept. Null when it could not be measured. */
    pages: number | null;
    maxPages: number;
    /** Compiles spent, including the first. */
    attempts: number;
    trimmed: TrimmedItem[];
};

export type CompileResult = { success: boolean; pdfBase64?: string; error?: string; pages?: number | null };
export type Measure = (pdfBase64: string) => Promise<{ pages: number | null; overflowLines?: number | null }>;

export type FitResult =
    | { ok: true; resume: ResumeData; latex: string; pdfBase64: string; fit: PageFit }
    | { ok: false; error: string };

/** Compiles, including the first. Each is a round trip to the LaTeX service. */
export const MAX_FIT_ATTEMPTS = 6;
/** Characters per printed line, roughly, at 10pt on A4. Used only to batch trims. */
const CHARS_PER_LINE = 100;

const bulletLines = (description: string) => description.split('\n').map((line) => line.trim()).filter(Boolean);
const linesFor = (text: string) => Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
const clean = (line: string) => line.replace(/^[\s•\-*·]+/, '').trim();

type Step = { item: TrimmedItem; lines: number; apply: (resume: ResumeData) => void };

/** The next trim, in the fixed order. Null when nothing more can go. */
export function nextTrim(resume: ResumeData): Step | null {
    // 1. the weakest project bullet
    for (let i = resume.projects.length - 1; i >= 0; i -= 1) {
        const project = resume.projects[i];
        const lines = bulletLines(project.description);
        if (lines.length < 2) continue;
        const last = lines[lines.length - 1];
        return {
            item: { kind: 'project_bullet', text: clean(last), targetId: project.id, targetKind: 'project', targetLabel: project.name },
            lines: linesFor(last),
            apply: (doc) => {
                doc.projects[i] = { ...doc.projects[i], description: lines.slice(0, -1).join('\n') };
            },
        };
    }

    // 2. a whole project
    if (resume.projects.length > 0) {
        const index = resume.projects.length - 1;
        const project = resume.projects[index];
        return {
            item: { kind: 'project', text: project.name, targetId: project.id, targetKind: 'project', targetLabel: project.name },
            lines: 1.5 + bulletLines(project.description).reduce((sum, line) => sum + linesFor(line), 0),
            apply: (doc) => {
                doc.projects = doc.projects.filter((_, at) => at !== index);
            },
        };
    }

    // 3. the About line
    if (resume.personalInfo.summary?.trim()) {
        const summary = resume.personalInfo.summary.trim();
        return {
            item: { kind: 'summary', text: summary },
            lines: 1.5 + linesFor(summary),
            apply: (doc) => {
                doc.personalInfo = { ...doc.personalInfo, summary: '' };
            },
        };
    }

    // 4. a skills row
    const rows = resolveSkillGroups(resume);
    if (rows.length > 1) {
        const row = rows[rows.length - 1];
        const gone = new Set(row.skills.map((skill) => skill.trim().toLowerCase()));
        return {
            item: { kind: 'skills_row', text: row.label ? `${row.label}: ${row.skills.join(', ')}` : row.skills.join(', ') },
            lines: 1,
            apply: (doc) => {
                doc.skills = doc.skills.filter((skill) => !gone.has(skill.trim().toLowerCase()));
            },
        };
    }

    // 5. the weakest experience bullet, from the role with the most lines
    let pick = -1;
    let most = 2;
    resume.experience.forEach((role, index) => {
        const count = bulletLines(role.description).length;
        // `>=` so a tie goes to the later, older role.
        if (count > 2 && count >= most) {
            most = count;
            pick = index;
        }
    });
    if (pick >= 0) {
        const role = resume.experience[pick];
        const lines = bulletLines(role.description);
        const last = lines[lines.length - 1];
        return {
            item: { kind: 'experience_bullet', text: clean(last), targetId: role.id, targetKind: 'experience', targetLabel: `${role.role} at ${role.company}` },
            lines: linesFor(last),
            apply: (doc) => {
                doc.experience[pick] = { ...doc.experience[pick], description: lines.slice(0, -1).join('\n') };
            },
        };
    }

    return null;
}

export async function fitToPages(params: {
    resume: ResumeData;
    render: (resume: ResumeData) => string;
    compile: (latex: string) => Promise<CompileResult>;
    /** Pages (and, ideally, lines past the budget) of a compiled PDF. */
    measure?: Measure;
    maxPages?: number;
    maxAttempts?: number;
}): Promise<FitResult> {
    const maxPages = Math.max(1, params.maxPages ?? 1);
    const maxAttempts = Math.max(1, params.maxAttempts ?? MAX_FIT_ATTEMPTS);
    const current: ResumeData = structuredClone(params.resume);
    const trimmed: TrimmedItem[] = [];
    let attempts = 0;

    for (;;) {
        const latex = params.render(current);
        const compiled = await params.compile(latex);
        attempts += 1;
        if (!compiled.success || !compiled.pdfBase64) {
            return { ok: false, error: compiled.error || 'Failed to compile PDF' };
        }

        const measured = params.measure ? await params.measure(compiled.pdfBase64) : null;
        const pages = measured?.pages ?? compiled.pages ?? null;
        const done = (status: PageFitStatus): FitResult => ({
            ok: true,
            resume: current,
            latex,
            pdfBase64: compiled.pdfBase64!,
            fit: { status, pages, maxPages, attempts, trimmed },
        });

        if (pages === null) return done('unchecked');
        if (pages <= maxPages) return done(trimmed.length > 0 ? 'trimmed' : 'fits');
        if (attempts >= maxAttempts) return done('over');

        // Trim until the estimate covers the overflow (one step when unknown),
        // so a page that runs four lines over costs one recompile, not four.
        const overflow = measured?.overflowLines ?? null;
        let removed = 0;
        let steps = 0;
        do {
            const step = nextTrim(current);
            if (!step) break;
            step.apply(current);
            trimmed.push(step.item);
            removed += step.lines;
            steps += 1;
        } while (overflow !== null && removed < overflow);
        if (steps === 0) return done('over');
    }
}

/** One plain sentence for a person, from a fit. Null when there is nothing to say. */
export function describeFit(fit: Pick<PageFit, 'status' | 'pages' | 'maxPages' | 'trimmed'>): string | null {
    const budget = fit.maxPages === 1 ? 'one page' : `${fit.maxPages} pages`;
    if (fit.status === 'over') {
        return `Still ${fit.pages} pages after trimming. It needs to come down to ${budget}: remove a line or two yourself, and the preview will show when it fits.`;
    }
    if (fit.status === 'trimmed') {
        const count = fit.trimmed.length;
        return `Fits on ${budget}. To get there we left out ${count} item${count === 1 ? '' : 's'}, listed below.`;
    }
    return null;
}
