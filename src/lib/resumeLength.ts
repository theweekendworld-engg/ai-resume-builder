import { DEFAULT_TEMPLATE_ID, canonicalTemplateId, type CanonicalTemplateId, type ResumeData, type ResumeTemplateId } from '@/types/resume';
import { isShortRole } from '@/templates/latex';

/**
 * Heuristic length estimate for the live page indicator.
 *
 * We approximate the rendered height of a resume from its content by counting
 * the visual "lines" each section contributes (headers, entries, wrapped bullet
 * text), then dividing by an approximate lines-per-page budget. This is a
 * client-side estimate only — the authoritative length comes from the compiled
 * PDF, but this is good enough for a live "fits on N pages" signal while editing.
 */

interface LayoutProfile {
    linesPerPage: number;
    charsPerLine: number;
}

/**
 * Every template at normal density, calibrated on the owner's resume compiled
 * for real (src/__fixtures__/resume/resumeAiVoice.ts, 2026-11-08): as
 * imported, with one-line bullets added one at a time, and with a three-line
 * summary. Each template holds the resume plus two more lines on one page and
 * breaks at the third; `linesPerPage` is the estimate just before that break. `charsPerLine` is the median full bullet line in
 * the PDF's own extracted text.
 *
 * All five print a project's stack on its title line and an internship on
 * one line (its sentence after the title), which the count below assumes.
 */
const LAYOUTS: Record<CanonicalTemplateId, LayoutProfile> = {
    compact: { linesPerPage: 57, charsPerLine: 112 },
    executive: { linesPerPage: 56, charsPerLine: 116 },
    tech: { linesPerPage: 57, charsPerLine: 106 },
    minimal: { linesPerPage: 57, charsPerLine: 110 },
    'ats-simple': { linesPerPage: 57, charsPerLine: 112 },
};

function wrappedLines(text: string, charsPerLine: number): number {
    if (!text) return 0;
    // Each explicit bullet/newline is a line; long lines wrap.
    const segments = text
        .split(/\r?\n/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (segments.length === 0) return 0;
    return segments.reduce((total, segment) => total + Math.max(1, Math.ceil(segment.length / charsPerLine)), 0);
}

export interface ResumeLengthEstimate {
    estimatedLines: number;
    estimatedPages: number; // e.g. 1.3
    pageCount: number; // ceil, min 1
    overflowLines: number; // lines past a single page (0 if within one page)
    fitsOnePage: boolean;
}

/** `templateId` picks the layout the estimate is for; without it, the default template's. */
export function estimateResumeLength(data: ResumeData, templateId: ResumeTemplateId = DEFAULT_TEMPLATE_ID): ResumeLengthEstimate {
    const layout = LAYOUTS[canonicalTemplateId(templateId)];
    const LINES_PER_PAGE = layout.linesPerPage;
    const wrapped = (text: string) => wrappedLines(text, layout.charsPerLine);
    let lines = 0;

    // Header block (name, contact line, title).
    lines += 3;

    // Summary.
    if (data.personalInfo.summary?.trim()) {
        lines += 1; // section header
        lines += wrapped(data.personalInfo.summary);
    }

    // Experience: header + per-entry title/meta line + bullets.
    if (data.experience.length > 0) {
        lines += 1;
        for (const exp of data.experience) {
            if (isShortRole(exp)) {
                // "Company, Role. What was done" as one wrapped line.
                const line = exp.description.replace(/^[\s•\-*]+/, '').trim();
                lines += wrapped(`${exp.company}, ${exp.role}. ${line}`);
                continue;
            }
            lines += 2; // role/company + dates/location
            lines += wrapped(exp.description);
            lines += 0.5; // spacing
        }
    }

    // Projects.
    if (data.projects.length > 0) {
        lines += 1;
        for (const project of data.projects) {
            lines += 1; // name + links
            lines += wrapped(project.description);
            lines += 0.5;
        }
    }

    // Education.
    if (data.education.length > 0) {
        lines += 1;
        lines += data.education.length * 2;
    }

    // Skills.
    if (data.skills.length > 0) {
        lines += 1;
        const skillsText = data.skills.join(', ');
        // A labelled row is a line of its own, however short.
        lines += Math.max(wrapped(skillsText), data.skillGroups?.length ?? 0);
    }

    const estimatedLines = Math.round(lines);
    const estimatedPages = Math.max(0, estimatedLines / LINES_PER_PAGE);
    const pageCount = Math.max(1, Math.ceil(estimatedPages));
    const overflowLines = Math.max(0, estimatedLines - LINES_PER_PAGE);

    return {
        estimatedLines,
        estimatedPages: Math.round(estimatedPages * 10) / 10,
        pageCount,
        overflowLines,
        fitsOnePage: estimatedLines <= LINES_PER_PAGE,
    };
}
