export type SectionType = 'experience' | 'projects' | 'education' | 'skills' | 'summary';

export interface ResumeData {
    personalInfo: PersonalInfo;
    experience: ExperienceItem[];
    projects: ProjectItem[];
    education: EducationItem[];
    skills: string[];
    sectionOrder: SectionType[]; // Order of sections in the resume
}

export interface PersonalInfo {
    fullName: string;
    title: string; // Job title/role (e.g., "Software Engineer")
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    summary: string;
}

export interface ExperienceItem {
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    current: boolean;
    location: string;
    description: string; // HTML or rich text content
}

export interface ProjectItem {
    id: string;
    name: string;
    description: string;
    url: string;
    technologies: string[];
}

export interface EducationItem {
    id: string;
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
    current: boolean;
}

export const initialResumeData: ResumeData = {
    personalInfo: {
        fullName: "",
        title: "",
        email: "",
        phone: "",
        location: "",
        website: "",
        linkedin: "",
        github: "",
        summary: "",
    },
    experience: [],
    projects: [],
    education: [],
    skills: [],
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
};
