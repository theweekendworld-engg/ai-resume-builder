import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeData, initialResumeData, ExperienceItem, ProjectItem, EducationItem, SectionType } from '@/types/resume';
import { v4 as uuidv4 } from 'uuid';
import { LatexTemplateType, generateLatexFromResume, DEFAULT_LATEX_TEMPLATE } from '@/templates/latex';
import { latexToResume } from '@/actions/ai';

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

    // Setters
    setResumeData: (data: ResumeData) => void;
    setJobDescription: (description: string) => void;
    setGithubUsername: (username: string) => void;
    setLatexCode: (code: string) => void;
    setAtsScore: (score: ATSScore | null) => void;
    setEditorMode: (mode: 'visual' | 'latex') => void;
    setSelectedTemplate: (template: LatexTemplateType) => void;
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

    generateLatexFromData: () => void;
    updatePersonalInfo: (info: Partial<ResumeData['personalInfo']>) => void;

    // Experience
    addExperience: () => void;
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
            setSelectedTemplate: (template) => set({ selectedTemplate: template }),
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
                const { resumeData, selectedTemplate } = get();
                const latex = generateLatexFromResume(resumeData, selectedTemplate);
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

            generateLatexFromData: () => {
                const { resumeData, selectedTemplate } = get();
                const latex = generateLatexFromResume(resumeData, selectedTemplate);
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

            addExperience: () => {
                const { resumeData, visualDataVersion } = get();
                set({
                    resumeData: {
                        ...resumeData,
                        experience: [
                            ...resumeData.experience,
                            {
                                id: uuidv4(),
                                company: "",
                                role: "",
                                startDate: "",
                                endDate: "",
                                current: false,
                                location: "",
                                description: "",
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
                    // Generate latex if empty
                    if (!hydratedState.latexCode) {
                        hydratedState.latexCode = generateLatexFromResume(
                            hydratedState.resumeData,
                            hydratedState.selectedTemplate || 'ats-simple'
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
