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

export interface ResumeGenerationPreferences {
    targetLength?: '1-page' | '2-page' | 'auto';
}

export const initialResumeData: ResumeData = {
    personalInfo: {
        fullName: "Alex Johnson",
        title: "Full Stack Developer",
        email: "alex.johnson@email.com",
        phone: "+1 (555) 123-4567",
        location: "San Francisco, CA",
        website: "alexjohnson.dev",
        linkedin: "linkedin.com/in/alexjohnson",
        github: "github.com/alexjohnson",
        summary: "Full Stack Developer with 4+ years of experience building scalable web applications. Proficient in React, Node.js, and cloud technologies. Passionate about creating intuitive user experiences and writing clean, maintainable code. Led development of features used by 50K+ users.",
    },
    experience: [
        {
            id: "exp-1",
            company: "TechCorp Inc.",
            role: "Senior Full Stack Developer",
            startDate: "Jan 2022",
            endDate: "",
            current: true,
            location: "San Francisco, CA",
            description: "• Led development of a customer-facing dashboard that increased user engagement by 40%\n• Architected and implemented microservices using Node.js and PostgreSQL, reducing API response times by 60%\n• Mentored 3 junior developers and conducted code reviews to maintain code quality standards\n• Collaborated with product and design teams to deliver 15+ features on schedule",
        },
        {
            id: "exp-2",
            company: "StartupXYZ",
            role: "Full Stack Developer",
            startDate: "Jun 2020",
            endDate: "Dec 2021",
            current: false,
            location: "Remote",
            description: "• Built and maintained React components for an e-commerce platform serving 10K+ daily active users\n• Developed RESTful APIs using Express.js and integrated third-party payment gateways\n• Improved page load times by 50% through code splitting and lazy loading optimizations\n• Implemented automated testing with Jest, achieving 85% code coverage",
        },
    ],
    projects: [
        {
            id: "proj-1",
            name: "TaskFlow - Project Management Tool",
            description: "A real-time collaborative project management application with drag-and-drop functionality, team chat, and automated workflow triggers. Supports 1000+ concurrent users with WebSocket-based real-time updates.",
            url: "https://github.com/alexjohnson/taskflow",
            technologies: ["React", "TypeScript", "Node.js", "PostgreSQL", "Redis", "WebSocket"],
        },
        {
            id: "proj-2",
            name: "AI Resume Builder",
            description: "An intelligent resume builder that uses AI to tailor resumes for specific job descriptions. Features ATS optimization, multiple templates, and real-time LaTeX preview.",
            url: "https://github.com/alexjohnson/resume-builder",
            technologies: ["Next.js", "OpenAI API", "Tailwind CSS", "LaTeX"],
        },
    ],
    education: [
        {
            id: "edu-1",
            institution: "University of California, Berkeley",
            degree: "Bachelor of Science",
            fieldOfStudy: "Computer Science",
            startDate: "Aug 2016",
            endDate: "May 2020",
            current: false,
        },
    ],
    skills: [
        "JavaScript",
        "TypeScript",
        "React",
        "Next.js",
        "Node.js",
        "Python",
        "PostgreSQL",
        "MongoDB",
        "Redis",
        "Docker",
        "AWS",
        "Git",
        "GraphQL",
        "REST APIs",
        "Tailwind CSS",
    ],
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'],
};
