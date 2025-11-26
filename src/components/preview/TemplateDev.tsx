import { ResumeData, SectionType } from '@/types/resume';
import { markdownToHtml, formatDate, getProjectLinkText } from '@/lib/utils';

interface TemplateProps {
    data: ResumeData;
}

export function TemplateDev({ data }: TemplateProps) {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    
    // Default order if not set
    const order = sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills'];

    return (
        <div className="font-sans text-slate-800 p-8 max-w-[210mm] min-h-[297mm] bg-white text-sm">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-4xl font-extrabold text-slate-900 mb-2">{personalInfo.fullName}</h1>
                {(personalInfo.title || (experience.length > 0 && experience[0].role)) && (
                    <div className="text-slate-700 text-lg font-medium mb-3">
                        {personalInfo.title || (experience.length > 0 ? experience[0].role : '')}
                    </div>
                )}
                <div className="text-slate-600 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {personalInfo.location && <span>{personalInfo.location}</span>}
                    {personalInfo.email && <span>{personalInfo.email}</span>}
                    {personalInfo.phone && <span>{personalInfo.phone}</span>}
                    {personalInfo.website && <a href={`https://${personalInfo.website}`} className="text-blue-600 hover:underline">{personalInfo.website}</a>}
                </div>
                <div className="flex gap-4 mt-2 text-sm font-medium">
                    {personalInfo.linkedin && <a href={personalInfo.linkedin} className="text-blue-700 hover:underline">LinkedIn</a>}
                    {personalInfo.github && <a href={personalInfo.github} className="text-slate-900 hover:underline">GitHub</a>}
                </div>
            </div>

            <div className="grid grid-cols-3 gap-8">
                {/* Main Column */}
                <div className="col-span-2 space-y-6">
                    {/* Render main sections in custom order */}
                    {order
                        .filter(section => ['summary', 'experience', 'projects'].includes(section))
                        .map((section) => {
                            switch (section) {
                                case 'summary':
                                    return personalInfo.summary ? (
                                        <section key="summary">
                                            <h2 className="text-xl font-bold text-slate-900 border-b-2 border-slate-200 pb-1 mb-3">Profile</h2>
                                            <p className="text-slate-700 leading-relaxed">{personalInfo.summary}</p>
                                        </section>
                                    ) : null;

                                case 'experience':
                                    return experience.length > 0 ? (
                                        <section key="experience">
                                            <h2 className="text-xl font-bold text-slate-900 border-b-2 border-slate-200 pb-1 mb-3">Experience</h2>
                                            <div className="space-y-6">
                                                {experience.map((exp) => (
                                                    <div key={exp.id}>
                                                        <div className="flex justify-between items-baseline mb-1">
                                                            <h3 className="font-bold text-lg text-slate-800">{exp.role}</h3>
                                                            <span className="text-sm text-slate-500 font-medium">{formatDate(exp.startDate)} – {exp.current ? "Present" : formatDate(exp.endDate)}</span>
                                                        </div>
                                                        <div className="text-blue-600 font-medium mb-2">{exp.company} • {exp.location}</div>
                                                        <div className="text-slate-700 pl-4 border-l-2 border-slate-100" dangerouslySetInnerHTML={{ __html: markdownToHtml(exp.description) }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null;

                                case 'projects':
                                    return projects.length > 0 ? (
                                        <section key="projects">
                                            <h2 className="text-xl font-bold text-slate-900 border-b-2 border-slate-200 pb-1 mb-3">Projects</h2>
                                            <div className="space-y-4">
                                                {projects.map((proj) => (
                                                    <div key={proj.id}>
                                                        <div className="flex justify-between items-baseline">
                                                            <h3 className="font-bold text-slate-800">{proj.name}</h3>
                                                            {proj.url && (
                                                                <a 
                                                                    href={proj.url} 
                                                                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline ml-2" 
                                                                    target="_blank" 
                                                                    rel="noopener noreferrer"
                                                                >
                                                                    {getProjectLinkText(proj.url)}
                                                                </a>
                                                            )}
                                                        </div>
                                                        <div className="text-slate-700 mb-1" dangerouslySetInnerHTML={{ __html: markdownToHtml(proj.description) }} />
                                                        {proj.technologies.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {proj.technologies.map(tech => (
                                                                    <span key={tech} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{tech}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null;

                                default:
                                    return null;
                            }
                        })}
                </div>

                {/* Sidebar Column */}
                <div className="space-y-6">
                    {/* Render sidebar sections in custom order */}
                    {order
                        .filter(section => ['skills', 'education'].includes(section))
                        .map((section) => {
                            switch (section) {
                                case 'skills':
                                    return skills.length > 0 ? (
                                        <section key="skills">
                                            <h2 className="text-lg font-bold text-slate-900 border-b-2 border-slate-200 pb-1 mb-3">Skills</h2>
                                            <div className="flex flex-wrap gap-2">
                                                {skills.map((skill) => (
                                                    <span key={skill} className="bg-slate-800 text-white text-xs font-medium px-2.5 py-1 rounded-md">
                                                        {skill}
                                                    </span>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null;

                                case 'education':
                                    return education.length > 0 ? (
                                        <section key="education">
                                            <h2 className="text-lg font-bold text-slate-900 border-b-2 border-slate-200 pb-1 mb-3">Education</h2>
                                            <div className="space-y-4">
                                                {education.map((edu) => (
                                                    <div key={edu.id}>
                                                        <div className="font-bold text-slate-800">{edu.institution}</div>
                                                        <div className="text-sm text-slate-600">{edu.degree}</div>
                                                        <div className="text-sm text-slate-500">{edu.fieldOfStudy}</div>
                                                        <div className="text-xs text-slate-400 mt-1">{formatDate(edu.startDate)} – {edu.current ? "Present" : formatDate(edu.endDate)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null;

                                default:
                                    return null;
                            }
                        })}
                </div>
            </div>
        </div>
    );
}
