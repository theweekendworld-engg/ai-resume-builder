import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeData, initialResumeData, ExperienceItem, ProjectItem, EducationItem, SectionType } from '@/types/resume';
import { v4 as uuidv4 } from 'uuid';
import { LatexTemplateType, generateLatexFromResume, DEFAULT_LATEX_TEMPLATE } from '@/templates/latex';

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

interface ResumeState {
    resumeData: ResumeData;
    jobDescription: string;
    githubUsername: string;
    latexCode: string;
    atsScore: ATSScore | null;
    editorMode: 'visual' | 'latex';
    selectedTemplate: LatexTemplateType;
    isGenerating: boolean;

    // Cloud sync state
    cloudSyncEnabled: boolean;
    syncStatus: SyncStatus;
    lastSyncedAt: Date | null;

    // Setters
    setResumeData: (data: ResumeData) => void;
    setJobDescription: (description: string) => void;
    setGithubUsername: (username: string) => void;
    setLatexCode: (code: string) => void;
    setAtsScore: (score: ATSScore | null) => void;
    setEditorMode: (mode: 'visual' | 'latex') => void;
    setSelectedTemplate: (template: LatexTemplateType) => void;
    setIsGenerating: (generating: boolean) => void;

    // Cloud sync setters
    setCloudSyncEnabled: (enabled: boolean) => void;
    setSyncStatus: (status: SyncStatus) => void;
    setLastSyncedAt: (date: Date | null) => void;

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

const initialATSScore: ATSScore = {
    overall: 0,
    breakdown: {
        keywordMatch: 0,
        skillsMatch: 0,
        experienceRelevance: 0,
        formattingScore: 0,
    },
    matchedKeywords: [],
    missingKeywords: [],
    suggestions: [],
};

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

            // Cloud sync state (default OFF for privacy-first)
            cloudSyncEnabled: false,
            syncStatus: 'idle' as SyncStatus,
            lastSyncedAt: null,

            setResumeData: (data) => set({
                resumeData: {
                    ...data,
                    sectionOrder: data.sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills']
                }
            }),
            setJobDescription: (description) => set({ jobDescription: description }),
            setGithubUsername: (username) => set({ githubUsername: username }),
            setLatexCode: (code) => set({ latexCode: code }),
            setAtsScore: (score) => set({ atsScore: score }),
            setEditorMode: (mode) => set({ editorMode: mode }),
            setSelectedTemplate: (template) => {
                const { resumeData, editorMode } = get();
                set({ selectedTemplate: template });
                if (editorMode === 'visual') {
                    const latex = generateLatexFromResume(resumeData, template);
                    set({ latexCode: latex });
                }
            },
            setIsGenerating: (generating) => set({ isGenerating: generating }),

            // Cloud sync setters
            setCloudSyncEnabled: (enabled) => set({ cloudSyncEnabled: enabled }),
            setSyncStatus: (status) => set({ syncStatus: status }),
            setLastSyncedAt: (date) => set({ lastSyncedAt: date }),

            generateLatexFromData: () => {
                const { resumeData, selectedTemplate } = get();
                const latex = generateLatexFromResume(resumeData, selectedTemplate);
                set({ latexCode: latex });
            },

            updatePersonalInfo: (info) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    personalInfo: { ...resumeData.personalInfo, ...info },
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            addExperience: () => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    experience: [
                        ...resumeData.experience,
                        {
                            id: uuidv4(),
                            company: "New Company",
                            role: "Role",
                            startDate: "",
                            endDate: "",
                            current: false,
                            location: "",
                            description: "Responsibility 1",
                        },
                    ],
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            updateExperience: (id, item) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    experience: resumeData.experience.map((exp) =>
                        exp.id === id ? { ...exp, ...item } : exp
                    ),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            removeExperience: (id) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    experience: resumeData.experience.filter((exp) => exp.id !== id),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            reorderExperience: (items) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = { ...resumeData, experience: items };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            addProject: (data) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    projects: [
                        ...resumeData.projects,
                        {
                            id: uuidv4(),
                            name: data?.name || "New Project",
                            description: data?.description || "Project description...",
                            url: data?.url || "",
                            technologies: data?.technologies || [],
                        },
                    ],
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            updateProject: (id, item) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    projects: resumeData.projects.map((proj) =>
                        proj.id === id ? { ...proj, ...item } : proj
                    ),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            removeProject: (id) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    projects: resumeData.projects.filter((proj) => proj.id !== id),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            reorderProjects: (items) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = { ...resumeData, projects: items };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            addEducation: () => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    education: [
                        ...resumeData.education,
                        {
                            id: uuidv4(),
                            institution: "University",
                            degree: "Degree",
                            fieldOfStudy: "Field",
                            startDate: "",
                            endDate: "",
                            current: false,
                        },
                    ],
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            updateEducation: (id, item) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    education: resumeData.education.map((edu) =>
                        edu.id === id ? { ...edu, ...item } : edu
                    ),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },
            removeEducation: (id) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    education: resumeData.education.filter((edu) => edu.id !== id),
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            updateSkills: (skills) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = { ...resumeData, skills };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            updateSectionOrder: (order) => {
                const { resumeData, selectedTemplate, editorMode } = get();
                const newResumeData = {
                    ...resumeData,
                    sectionOrder: order
                };
                const updates: Partial<ResumeState> = { resumeData: newResumeData };
                if (editorMode === 'visual') {
                    updates.latexCode = generateLatexFromResume(newResumeData, selectedTemplate);
                }
                set(updates);
            },

            resetResume: () => set({
                resumeData: initialResumeData,
                jobDescription: '',
                githubUsername: '',
                atsScore: null,
                latexCode: DEFAULT_LATEX_TEMPLATE,
            }),

            isUsingSampleData: () => {
                const { resumeData } = get();
                return resumeData.personalInfo.fullName === 'Alex Johnson' &&
                    resumeData.personalInfo.email === 'alex.johnson@email.com';
            },
        }),
        {
            name: 'resume-storage',
            merge: (persistedState: any, currentState) => {
                if (persistedState?.resumeData) {
                    if (!persistedState.resumeData.sectionOrder) {
                        persistedState.resumeData.sectionOrder = ['summary', 'experience', 'projects', 'education', 'skills'];
                    }
                    if (!persistedState.selectedTemplate) {
                        persistedState.selectedTemplate = 'ats-simple';
                    }
                    // Generate latex if empty
                    if (!persistedState.latexCode) {
                        persistedState.latexCode = generateLatexFromResume(
                            persistedState.resumeData,
                            persistedState.selectedTemplate || 'ats-simple'
                        );
                    }
                    return {
                        ...currentState,
                        ...persistedState,
                    };
                }
                return currentState;
            },
        }
    )
);
