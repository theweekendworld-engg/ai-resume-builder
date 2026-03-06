import type { ExperienceItem, ProjectItem, ResumeData } from '@/types/resume';

export function buildBaseResume(params: {
  fallback: ResumeData;
  profile: {
    fullName: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    defaultTitle: string;
    defaultSummary: string;
  } | null;
  experiences: ExperienceItem[];
  education: ResumeData['education'];
  projects: ProjectItem[];
  skills: string[];
  jdRole: string;
  parsedSummary: string;
  sectionOrder: ResumeData['sectionOrder'];
}): ResumeData {
  const fallbackInfo = params.fallback.personalInfo;
  return {
    personalInfo: {
      fullName: params.profile?.fullName || fallbackInfo.fullName,
      title: params.jdRole || params.profile?.defaultTitle || fallbackInfo.title,
      email: params.profile?.email || fallbackInfo.email,
      phone: params.profile?.phone || fallbackInfo.phone,
      location: params.profile?.location || fallbackInfo.location,
      website: params.profile?.website || fallbackInfo.website,
      linkedin: params.profile?.linkedin || fallbackInfo.linkedin,
      github: params.profile?.github || fallbackInfo.github,
      summary: params.parsedSummary || params.profile?.defaultSummary || fallbackInfo.summary,
    },
    experience: params.experiences.length > 0 ? params.experiences : params.fallback.experience,
    projects: params.projects.length > 0 ? params.projects : params.fallback.projects,
    education: params.education.length > 0 ? params.education : params.fallback.education,
    skills: params.skills.length > 0 ? params.skills : params.fallback.skills,
    sectionOrder: params.sectionOrder,
  };
}
