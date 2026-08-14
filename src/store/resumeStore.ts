import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeData, initialResumeData, ExperienceItem, ProjectItem, EducationItem, SectionType, ResumeTheme, ResumeTemplateId, DEFAULT_RESUME_THEME } from '@/types/resume';
import { v4 as uuidv4 } from 'uuid';
import { LatexTemplateType, generateLatexFromResume, DEFAULT_LATEX_TEMPLATE } from '@/templates/latex';
import { latexToResume } from '@/actions/ai';
import type { ScoreFix } from '@/lib/anonScoreSchema';

export interface ATSScore {
    overall: number;
    breakdown: {
        keywordMatch: number;
        skillsMatch: number;
        experienceRelevance: number;
        formattingScore: number;
    };
    matchedKeywords: string[];
    missingKeywords: string[];
    suggestions: string[];
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export type CopilotSectionKey = 'summary' | 'experience' | 'projects' | 'skills';

/**
 * A fix carried over from the Phase 1 anonymous score, plus local resolution
 * state so the editor checklist can check items off as they are addressed.
 */
export interface FixChecklistItem extends ScoreFix {
    id: string;
    resolved: boolean;
}

export interface SectionDiff {
    before: string;
    after: string;
    changed: boolean;
}

export interface CopilotProposal {
    sections: {
        summary?: string;
        experience?: ExperienceItem[];
        projects?: ProjectItem[];
        skills?: string[];
    };
    diffs: {
        summary?: SectionDiff;
        experience?: SectionDiff;
        projects?: SectionDiff;
        skills?: SectionDiff;
    };
    rationale: string[];
    proposedAtsScore: number;
}

interface ResumeState {
    resumeData: ResumeData;
    jobDescription: string;
    githubUsername: string;
    latexCode: string;
    atsScore: ATSScore | null;
    editorMode: 'visual' | 'latex';
    selectedTemplate: LatexTemplateType;
    theme: ResumeTheme;
    isGenerating: boolean;

    // Sync tracking - tracks if visual/latex are out of sync
    lastSyncedLatex: string;
    visualDataVersion: number;
    latexVersion: number;

    syncStatus: SyncStatus;
    lastSyncedAt: Date | null;

    // Copilot state
    copilotProposal: CopilotProposal | null;
    copilotOpen: boolean;

    // Fix checklist (carried from the Phase 1 anonymous score)
    fixChecklist: FixChecklistItem[];

    // Setters
    setResumeData: (data: ResumeData) => void;
    setJobDescription: (description: string) => void;
    setGithubUsername: (username: string) => void;
    setLatexCode: (code: string) => void;
    setAtsScore: (score: ATSScore | null) => void;
    setEditorMode: (mode: 'visual' | 'latex') => void;
    setSelectedTemplate: (template: LatexTemplateType) => void;
    setTheme: (theme: ResumeTheme) => void;
    updateTheme: (patch: Partial<ResumeTheme>) => void;
    setTemplateId: (templateId: ResumeTemplateId) => void;
    setIsGenerating: (generating: boolean) => void;

    // Sync helpers
    isOutOfSync: () => boolean;
    hasVisualChanges: () => boolean;
    hasLatexChanges: () => boolean;
    syncVisualToLatex: () => void;
    syncLatexToVisual: () => Promise<void>;
    setResumeAndLatexInSync: (resumeData: ResumeData, latexCode: string) => void;
    isSyncingLatexToVisual: boolean;
    setSyncingLatexToVisual: (syncing: boolean) => void;

    setSyncStatus: (status: SyncStatus) => void;
    setLastSyncedAt: (date: Date | null) => void;

    // Copilot actions
    setCopilotProposal: (proposal: CopilotProposal | null) => void;
    setCopilotOpen: (open: boolean) => void;
    applyCopilotSection: (section: CopilotSectionKey) => void;
    applyCopilotAll: () => void;
    clearCopilotSession: () => void;

    // Fix checklist actions
    setFixChecklist: (fixes: ScoreFix[]) => void;
    toggleFixResolved: (id: string, resolved?: boolean) => void;
    clearFixChecklist: () => void;

    generateLatexFromData: () => void;
    updatePersonalInfo: (info: Partial<ResumeData['personalInfo']>) => void;

    // Experience
    addExperience: (data?: Partial<ExperienceItem>) => void;
    updateExperience: (id: string, item: Partial<ExperienceItem>) => void;
    removeExperience: (id: string) => void;
    reorderExperience: (items: ExperienceItem[]) => void;

    // Projects
    addProject: (data?: Partial<ProjectItem>) => void;
    updateProject: (id: string, item: Partial<ProjectItem>) => void;
    removeProject: (id: string) => void;
    reorderProjects: (items: ProjectItem[]) => void;

    // Education
    addEducation: () => void;
    updateEducation: (id: string, item: Partial<EducationItem>) => void;
    removeEducation: (id: string) => void;

    // Skills
    updateSkills: (skills: string[]) => void;

    // Section Order
    updateSectionOrder: (order: SectionType[]) => void;

    // Reset
    resetResume: () => void;

    // Check if using sample data
    isUsingSampleData: () => boolean;
}

function inferProjectUrls(data: Partial<ProjectItem>): { url: string; liveUrl: string; repoUrl: string } {
    const explicitLive = (data.liveUrl || '').trim();
    const explicitRepo = (data.repoUrl || '').trim();
    const repoUrl = explicitRepo;
    const liveUrl = explicitLive;
    const url = liveUrl || repoUrl || '';

    return { url, liveUrl, repoUrl };
}

export const useResumeStore = create<ResumeState>()(
    persist(
        (set, get) => ({
            resumeData: initialResumeData,
            jobDescription: '',
            githubUsername: '',
            latexCode: DEFAULT_LATEX_TEMPLATE,
            atsScore: null,
            editorMode: 'visual',
            selectedTemplate: 'ats-simple' as LatexTemplateType,
            theme: DEFAULT_RESUME_THEME,
            isGenerating: false,

            // Sync tracking
            lastSyncedLatex: DEFAULT_LATEX_TEMPLATE,
            visualDataVersion: 0,
            latexVersion: 0,
            isSyncingLatexToVisual: false,

            // Cloud sync state (always on for authenticated flows)
            syncStatus: 'idle' as SyncStatus,
            lastSyncedAt: null,

            // Copilot state
            copilotProposal: null,
            copilotOpen: false,

            // Fix checklist
            fixChecklist: [],

            setResumeData: (data) => {
                const { visualDataVersion } = get();
                const normalizedProjects = (data.projects || []).map((project) => {
                    const urls = inferProjectUrls(project);
                    return { ...project, ...urls };
                });
                set({
                    resumeData: {
                        ...data,
                        projects: normalizedProjects,
                        sectionOrder: data.sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills']
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            setJobDescription: (description) => set({ jobDescription: description }),
            setGithubUsername: (username) => set({ githubUsername: username }),
            setLatexCode: (code) => {
                const { latexVersion } = get();
                set({ latexCode: code, latexVersion: latexVersion + 1 });
            },
            setAtsScore: (score) => set({ atsScore: score }),
            setEditorMode: (mode) => set({ editorMode: mode }),
            setSelectedTemplate: (template) => {
                const { theme } = get();
                set({ selectedTemplate: template, theme: { ...theme, templateId: template } });
            },
            setTheme: (theme) => set({ theme, selectedTemplate: theme.templateId }),
            updateTheme: (patch) => {
                const { theme } = get();
                const next = { ...theme, ...patch };
                set({ theme: next, selectedTemplate: next.templateId });
            },
            setTemplateId: (templateId) => {
                const { theme } = get();
                set({ theme: { ...theme, templateId }, selectedTemplate: templateId });
            },
            setIsGenerating: (generating) => set({ isGenerating: generating }),

            // Sync helpers
            isOutOfSync: () => {
                const { visualDataVersion, latexVersion } = get();
                return visualDataVersion > 0 || latexVersion > 0;
            },
            hasVisualChanges: () => {
                const { visualDataVersion } = get();
                return visualDataVersion > 0;
            },
            hasLatexChanges: () => {
                const { latexVersion } = get();
                return latexVersion > 0;
            },
            syncVisualToLatex: () => {
                const { resumeData, theme } = get();
                const latex = generateLatexFromResume(resumeData, theme);
                set({ latexCode: latex, lastSyncedLatex: latex, latexVersion: 0, visualDataVersion: 0 });
            },
            syncLatexToVisual: async () => {
                const { latexCode } = get();
                set({ isSyncingLatexToVisual: true });
                try {
                    const resumeData = await latexToResume(latexCode);
                    const normalizedProjects = (resumeData.projects || []).map((project) => {
                        const urls = inferProjectUrls(project);
                        return { ...project, ...urls };
                    });
                    set({ 
                        resumeData: { ...resumeData, projects: normalizedProjects },
                        lastSyncedLatex: latexCode, 
                        latexVersion: 0, 
                        visualDataVersion: 0,
                        isSyncingLatexToVisual: false,
                    });
                } catch (error: unknown) {
                    console.error('Failed to sync LaTeX to visual:', error);
                    set({ isSyncingLatexToVisual: false });
                    throw error;
                }
            },
            setResumeAndLatexInSync: (resumeData, latexCode) => {
                const normalizedProjects = (resumeData.projects || []).map((project) => {
                    const urls = inferProjectUrls(project);
                    return { ...project, ...urls };
                });
                set({
                    resumeData: {
                        ...resumeData,
                        projects: normalizedProjects,
                        sectionOrder: resumeData.sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills']
                    },
                    latexCode,
                    lastSyncedLatex: latexCode,
                    visualDataVersion: 0,
                    latexVersion: 0,
                });
            },
            setSyncingLatexToVisual: (syncing) => set({ isSyncingLatexToVisual: syncing }),

            setSyncStatus: (status) => set({ syncStatus: status }),
            setLastSyncedAt: (date) => set({ lastSyncedAt: date }),

            // Copilot actions
            setCopilotProposal: (proposal) => set({ copilotProposal: proposal }),
            setCopilotOpen: (open) => set({ copilotOpen: open }),
            
            applyCopilotSection: (section) => {
                const { copilotProposal, resumeData, visualDataVersion } = get();
                if (!copilotProposal) return;

                const newResumeData = { ...resumeData };

                switch (section) {
                    case 'summary':
                        if (copilotProposal.sections.summary) {
                            newResumeData.personalInfo = {
                                ...newResumeData.personalInfo,
                                summary: copilotProposal.sections.summary,
                            };
                        }
                        break;
                    case 'experience':
                        if (copilotProposal.sections.experience) {
                            newResumeData.experience = copilotProposal.sections.experience;
                        }
                        break;
                    case 'projects':
                        if (copilotProposal.sections.projects) {
                            newResumeData.projects = copilotProposal.sections.projects.map((project) => {
                                const urls = inferProjectUrls(project);
                                return { ...project, ...urls };
                            });
                        }
                        break;
                    case 'skills':
                        if (copilotProposal.sections.skills) {
                            newResumeData.skills = copilotProposal.sections.skills;
                        }
                        break;
                }

                set({ resumeData: newResumeData, visualDataVersion: visualDataVersion + 1 });
            },

            applyCopilotAll: () => {
                const { copilotProposal, resumeData, visualDataVersion } = get();
                if (!copilotProposal) return;

                const newResumeData: ResumeData = {
                    ...resumeData,
                    personalInfo: {
                        ...resumeData.personalInfo,
                        summary: copilotProposal.sections.summary || resumeData.personalInfo.summary,
                    },
                    experience: copilotProposal.sections.experience || resumeData.experience,
                    projects: copilotProposal.sections.projects || resumeData.projects,
                    skills: copilotProposal.sections.skills || resumeData.skills,
                };

                const normalizedProjects = (newResumeData.projects || []).map((project) => {
                    const urls = inferProjectUrls(project);
                    return { ...project, ...urls };
                });

                set({
                    resumeData: { ...newResumeData, projects: normalizedProjects },
                    copilotProposal: null,
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            clearCopilotSession: () => set({
                copilotProposal: null,
                copilotOpen: false,
            }),

            // Fix checklist actions
            setFixChecklist: (fixes) => set({
                fixChecklist: fixes.map((fix, index) => ({
                    ...fix,
                    id: `fix-${index}-${uuidv4()}`,
                    resolved: false,
                })),
            }),
            toggleFixResolved: (id, resolved) => {
                const { fixChecklist } = get();
                set({
                    fixChecklist: fixChecklist.map((item) =>
                        item.id === id
                            ? { ...item, resolved: resolved ?? !item.resolved }
                            : item
                    ),
                });
            },
            clearFixChecklist: () => set({ fixChecklist: [] }),

            generateLatexFromData: () => {
                const { resumeData, theme } = get();
                const latex = generateLatexFromResume(resumeData, theme);
                set({ latexCode: latex, lastSyncedLatex: latex, latexVersion: 0, visualDataVersion: 0 });
            },

            updatePersonalInfo: (info) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        personalInfo: { ...resumeData.personalInfo, ...info },
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            addExperience: (data) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        experience: [
                            ...resumeData.experience,
                            {
                                id: uuidv4(),
                                company: data?.company || "",
                                role: data?.role || "",
                                startDate: data?.startDate || "",
                                endDate: data?.endDate || "",
                                current: data?.current || false,
                                location: data?.location || "",
                                description: data?.description || "",
                            },
                        ],
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            updateExperience: (id, item) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        experience: resumeData.experience.map((exp) =>
                            exp.id === id ? { ...exp, ...item } : exp
                        ),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            removeExperience: (id) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        experience: resumeData.experience.filter((exp) => exp.id !== id),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            reorderExperience: (items) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: { ...resumeData, experience: items },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            addProject: (data) => {
                const { resumeData, visualDataVersion } = get();
                const urls = inferProjectUrls(data || {});
                set({
                    resumeData: {
                        ...resumeData,
                        projects: [
                            ...resumeData.projects,
                            {
                                id: uuidv4(),
                                name: data?.name || "",
                                description: data?.description || "",
                                url: urls.url,
                                liveUrl: urls.liveUrl,
                                repoUrl: urls.repoUrl,
                                technologies: data?.technologies || [],
                            },
                        ],
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            updateProject: (id, item) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        projects: resumeData.projects.map((proj) =>
                            proj.id === id ? { ...proj, ...item } : proj
                        ),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            removeProject: (id) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        projects: resumeData.projects.filter((proj) => proj.id !== id),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            reorderProjects: (items) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: { ...resumeData, projects: items },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            addEducation: () => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        education: [
                            ...resumeData.education,
                            {
                                id: uuidv4(),
                                institution: "",
                                degree: "",
                                fieldOfStudy: "",
                                startDate: "",
                                endDate: "",
                                current: false,
                            },
                        ],
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            updateEducation: (id, item) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        education: resumeData.education.map((edu) =>
                            edu.id === id ? { ...edu, ...item } : edu
                        ),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },
            removeEducation: (id) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        education: resumeData.education.filter((edu) => edu.id !== id),
                    },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            updateSkills: (skills) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: { ...resumeData, skills },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            updateSectionOrder: (order) => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: { ...resumeData, sectionOrder: order },
                    visualDataVersion: visualDataVersion + 1,
                });
            },

            resetResume: () => set({
                resumeData: initialResumeData,
                jobDescription: '',
                githubUsername: '',
                atsScore: null,
                latexCode: DEFAULT_LATEX_TEMPLATE,
                lastSyncedLatex: DEFAULT_LATEX_TEMPLATE,
                visualDataVersion: 0,
                latexVersion: 0,
            }),

            isUsingSampleData: () => {
                return false;
            },
        }),
        {
            name: 'resume-storage',
            partialize: (state) => ({
                resumeData: state.resumeData,
                githubUsername: state.githubUsername,
                latexCode: state.latexCode,
                editorMode: state.editorMode,
                selectedTemplate: state.selectedTemplate,
                theme: state.theme,
                isGenerating: state.isGenerating,
                lastSyncedLatex: state.lastSyncedLatex,
                visualDataVersion: state.visualDataVersion,
                latexVersion: state.latexVersion,
                fixChecklist: state.fixChecklist,
            }),
            merge: (persistedState: unknown, currentState) => {
                const hydratedState = (persistedState ?? {}) as Partial<ResumeState>;
                if (hydratedState.resumeData) {
                    hydratedState.resumeData.projects = (hydratedState.resumeData.projects || []).map((project) => {
                        const urls = inferProjectUrls(project);
                        return {
                            ...project,
                            url: urls.url,
                            liveUrl: urls.liveUrl,
                            repoUrl: urls.repoUrl,
                        };
                    });
                    if (!hydratedState.resumeData.sectionOrder) {
                        hydratedState.resumeData.sectionOrder = ['summary', 'experience', 'projects', 'education', 'skills'];
                    }
                    if (!hydratedState.selectedTemplate) {
                        hydratedState.selectedTemplate = 'ats-simple';
                    }
                    // Backfill the theme for users persisted before themes existed.
                    if (!hydratedState.theme) {
                        hydratedState.theme = {
                            ...DEFAULT_RESUME_THEME,
                            templateId: hydratedState.selectedTemplate || 'ats-simple',
                        };
                    } else {
                        hydratedState.theme = { ...DEFAULT_RESUME_THEME, ...hydratedState.theme };
                        // Keep the legacy mirror consistent with the persisted theme.
                        hydratedState.selectedTemplate = hydratedState.theme.templateId;
                    }
                    // Generate latex if empty
                    if (!hydratedState.latexCode) {
                        hydratedState.latexCode = generateLatexFromResume(
                            hydratedState.resumeData,
                            hydratedState.theme
                        );
                    }
                    // Initialize sync tracking
                    if (!hydratedState.lastSyncedLatex) {
                        hydratedState.lastSyncedLatex = hydratedState.latexCode;
                    }
                    if (hydratedState.visualDataVersion === undefined) {
                        hydratedState.visualDataVersion = 0;
                    }
                    if (hydratedState.latexVersion === undefined) {
                        hydratedState.latexVersion = 0;
                    }
                    return {
                        ...currentState,
                        ...hydratedState,
                    };
                }
                return currentState;
            },
        }
    )
);
