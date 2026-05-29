import type { ResumeData } from '@/types/resume';

/**
 * Heuristic length estimate for the live page indicator.
 *
 * We approximate the rendered height of a resume from its content by counting
 * the visual "lines" each section contributes (headers, entries, wrapped bullet
 * text), then dividing by an approximate lines-per-page budget. This is a
 * client-side estimate only — the authoritative length comes from the compiled
 * PDF, but this is good enough for a live "fits on N pages" signal while editing.
 */

// Tuned against the ats-simple template at normal density.
const LINES_PER_PAGE = 48;
const CHARS_PER_LINE = 95;

function wrappedLines(text: string): number {
    if (!text) return 0;
    // Each explicit bullet/newline is a line; long lines wrap.
    const segments = text
        .split(/\r?\n/)
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (segments.length === 0) return 0;
    return segments.reduce((total, segment) => total + Math.max(1, Math.ceil(segment.length / CHARS_PER_LINE)), 0);
}

export interface ResumeLengthEstimate {
    estimatedLines: number;
    estimatedPages: number; // e.g. 1.3
    pageCount: number; // ceil, min 1
    overflowLines: number; // lines past a single page (0 if within one page)
    fitsOnePage: boolean;
}

export function estimateResumeLength(data: ResumeData): ResumeLengthEstimate {
    let lines = 0;

    // Header block (name, contact line, title).
    lines += 3;

    // Summary.
    if (data.personalInfo.summary?.trim()) {
        lines += 1; // section header
        lines += wrappedLines(data.personalInfo.summary);
    }

    // Experience: header + per-entry title/meta line + bullets.
    if (data.experience.length > 0) {
        lines += 1;
        for (const exp of data.experience) {
            lines += 2; // role/company + dates/location
            lines += wrappedLines(exp.description);
            lines += 0.5; // spacing
        }
    }

    // Projects.
    if (data.projects.length > 0) {
        lines += 1;
        for (const project of data.projects) {
            lines += 1; // name + links
            lines += wrappedLines(project.description);
            if (project.technologies.length > 0) lines += 1;
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
        lines += wrappedLines(skillsText);
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
