import type { ResumeData, ResumeTemplateId } from '@/types/resume';
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
    /** Compact prints the stack on the project's title line, not a line of its own. */
    techLine: boolean;
    /** Compact prints an internship on one line, its sentence after the title. */
    shortRolesInline: boolean;
}

// The older templates: tuned against ats-simple at normal density.
const DEFAULT_LAYOUT: LayoutProfile = { linesPerPage: 48, charsPerLine: 95, techLine: true, shortRolesInline: false };

// Compact: calibrated on the owner's resume compiled for real (2026-11-07):
// as imported it is one page with about five lines spare (55 here), and with
// a three-line summary added it runs five lines onto a second page (59).
const COMPACT_LAYOUT: LayoutProfile = { linesPerPage: 56, charsPerLine: 112, techLine: false, shortRolesInline: true };

function layoutFor(templateId: ResumeTemplateId | undefined): LayoutProfile {
    return templateId === 'compact' ? COMPACT_LAYOUT : DEFAULT_LAYOUT;
}

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

/** `templateId` picks the layout the estimate is for; without it, the older templates'. */
export function estimateResumeLength(data: ResumeData, templateId?: ResumeTemplateId): ResumeLengthEstimate {
    const layout = layoutFor(templateId);
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
            if (layout.shortRolesInline && isShortRole(exp)) {
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
            if (layout.techLine && project.technologies.length > 0) lines += 1;
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
