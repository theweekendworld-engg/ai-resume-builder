import type { EducationItem, ExperienceItem, ProjectItem, ResumeData } from '@/types/resume';
import type { CoverageReport } from './coverage';
import type { PostingBrief } from './posting';

/**
 * The generation contract, kept after the pipeline that defined it was deleted.
 *
 * `tailor.ts` owned these types and also owned a fixed six-stage assembly that
 * the agentic loop replaced. The stages are gone; the shape stays, because
 * `generateResume.ts` threads all six fields into the coverage report, the gap
 * panel, the claim validator and the session record. Keeping the contract is
 * what let the generator be swapped in one commit instead of ten.
 */

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
