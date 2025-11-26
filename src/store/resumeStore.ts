import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeData, initialResumeData, ExperienceItem, ProjectItem, EducationItem, SectionType } from '@/types/resume';
import { v4 as uuidv4 } from 'uuid';

interface ResumeState {
    resumeData: ResumeData;
    setResumeData: (data: ResumeData) => void;
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
}

export const useResumeStore = create<ResumeState>()(
    persist(
        (set) => ({
            resumeData: initialResumeData,
            setResumeData: (data) => set({ 
                resumeData: {
                    ...data,
                    sectionOrder: data.sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills']
                }
            }),
            updatePersonalInfo: (info) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        personalInfo: { ...state.resumeData.personalInfo, ...info },
                    },
                })),

            addExperience: () =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        experience: [
                            ...state.resumeData.experience,
                            {
                                id: uuidv4(),
                                company: "New Company",
                                role: "Role",
                                startDate: "",
                                endDate: "",
                                current: false,
                                location: "",
                                description: "<ul><li>Responsibility 1</li></ul>",
                            },
                        ],
                    },
                })),
            updateExperience: (id, item) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        experience: state.resumeData.experience.map((exp) =>
                            exp.id === id ? { ...exp, ...item } : exp
                        ),
                    },
                })),
            removeExperience: (id) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        experience: state.resumeData.experience.filter((exp) => exp.id !== id),
                    },
                })),
            reorderExperience: (items) =>
                set((state) => ({
                    resumeData: { ...state.resumeData, experience: items },
                })),

            addProject: (data) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        projects: [
                            ...state.resumeData.projects,
                            {
                                id: uuidv4(),
                                name: data?.name || "New Project",
                                description: data?.description || "Project description...",
                                url: data?.url || "",
                                technologies: data?.technologies || [],
                            },
                        ],
                    },
                })),
            updateProject: (id, item) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        projects: state.resumeData.projects.map((proj) =>
                            proj.id === id ? { ...proj, ...item } : proj
                        ),
                    },
                })),
            removeProject: (id) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        projects: state.resumeData.projects.filter((proj) => proj.id !== id),
                    },
                })),
            reorderProjects: (items) =>
                set((state) => ({
                    resumeData: { ...state.resumeData, projects: items },
                })),

            addEducation: () =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        education: [
                            ...state.resumeData.education,
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
                    },
                })),
            updateEducation: (id, item) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        education: state.resumeData.education.map((edu) =>
                            edu.id === id ? { ...edu, ...item } : edu
                        ),
                    },
                })),
            removeEducation: (id) =>
                set((state) => ({
                    resumeData: {
                        ...state.resumeData,
                        education: state.resumeData.education.filter((edu) => edu.id !== id),
                    },
                })),

            updateSkills: (skills) =>
                set((state) => ({
                    resumeData: { ...state.resumeData, skills },
                })),

            updateSectionOrder: (order) =>
                set((state) => ({
                    resumeData: { 
                        ...state.resumeData, 
                        sectionOrder: order 
                    },
                })),
        }),
        {
            name: 'resume-storage',
            merge: (persistedState: any, currentState) => {
                // Migration: ensure sectionOrder exists in persisted data
                if (persistedState?.resumeData) {
                    if (!persistedState.resumeData.sectionOrder) {
                        persistedState.resumeData.sectionOrder = ['summary', 'experience', 'projects', 'education', 'skills'];
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
