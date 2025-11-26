import { ResumeData, SectionType } from '@/types/resume';
import { markdownToHtml, formatDate, getProjectLinkText } from '@/lib/utils';

interface TemplateProps {
    data: ResumeData;
}

export function TemplateAts({ data }: TemplateProps) {
    const { personalInfo, experience, projects, education, skills, sectionOrder } = data;
    
    // Default order if not set
    const order = sectionOrder || ['summary', 'experience', 'projects', 'education', 'skills'];

    return (
        <div className="font-sans text-black p-8 max-w-[210mm] min-h-[297mm] bg-white text-sm leading-relaxed">
            {/* Header - Personal Details */}
            <div className="mb-5">
                <h1 className="text-xl font-bold mb-0.5">{personalInfo.fullName || 'Your Name'}</h1>
                {(personalInfo.title || (experience.length > 0 && experience[0].role)) && (
                    <div className="text-sm font-normal mb-1.5">
                        {personalInfo.title || (experience.length > 0 ? experience[0].role : '')}
                    </div>
                )}
                <div className="text-xs text-gray-700">
                    {[
                        personalInfo.location,
                        personalInfo.email,
                        personalInfo.phone,
                        personalInfo.linkedin && 'LinkedIn',
                        personalInfo.github && 'GitHub',
                        personalInfo.website && 'Portfolio'
                    ].filter(Boolean).join(' • ')}
                </div>
            </div>

            {/* Render sections in custom order */}
            {order.map((section) => {
                switch (section) {
                    case 'summary':
                        return personalInfo.summary ? (
                            <div key="summary" className="mb-4">
                                <h2 className="font-bold text-sm mb-1.5">ABOUT ME</h2>
                                <p className="text-xs leading-relaxed text-gray-800">{personalInfo.summary}</p>
                            </div>
                        ) : null;

                    case 'experience':
                        return experience.length > 0 ? (
                            <div key="experience" className="mb-4">
                                <h2 className="font-bold text-sm mb-2.5">WORK EXPERIENCE</h2>
                                <div className="space-y-3">
                                    {experience.map((exp) => (
                                        <div key={exp.id} className="mb-3">
                                            <div className="flex justify-between items-start mb-0.5">
                                                <div className="flex-1">
                                                    <div className="font-semibold text-sm">{exp.role}</div>
                                                    <div className="text-xs font-medium text-gray-700">{exp.company}, {exp.location}</div>
                                                </div>
                                                <div className="text-xs font-medium text-gray-700 whitespace-nowrap ml-4">
                                                    {formatDate(exp.startDate)} – {exp.current ? "Present" : formatDate(exp.endDate)}
                                                </div>
                                            </div>
                                            <div 
                                                className="text-xs leading-relaxed mt-2 space-y-1"
                                                dangerouslySetInnerHTML={{ 
                                                    __html: exp.description
                                                        .split('\n')
                                                        .filter(line => line.trim())
                                                        .map(line => {
                                                            const cleanLine = line.replace(/^[•\-\*]\s*/, '').trim();
                                                            if (!cleanLine) return '';
                                                            const formatted = markdownToHtml(cleanLine);
                                                            return `<div class="flex"><span class="mr-2">•</span><span>${formatted}</span></div>`;
                                                        })
                                                        .join('')
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null;

                    case 'projects':
                        return projects.length > 0 ? (
                            <div key="projects" className="mb-4">
                                <h2 className="font-bold text-sm mb-2.5">PROJECTS</h2>
                                <div className="space-y-3">
                                    {projects.map((proj) => (
                                        <div key={proj.id} className="mb-2.5">
                                            <div className="flex justify-between items-start mb-0.5">
                                                <div className="font-semibold text-sm flex-1">{proj.name}</div>
                                                {proj.url && (
                                                    <a 
                                                        href={proj.url} 
                                                        className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline ml-2" 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                    >
                                                        {getProjectLinkText(proj.url)}
                                                    </a>
                                                )}
                                            </div>
                                            <div 
                                                className="text-xs leading-relaxed mb-1"
                                                dangerouslySetInnerHTML={{ 
                                                    __html: markdownToHtml(proj.description)
                                                }}
                                            />
                                            {proj.technologies.length > 0 && (
                                                <p className="text-[10px] italic text-gray-600 mt-1">Tech stack: {proj.technologies.join(', ')}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null;

                    case 'education':
                        return education.length > 0 ? (
                            <div key="education" className="mb-4">
                                <h2 className="font-bold text-sm mb-2">EDUCATION</h2>
                                <div className="space-y-2">
                                    {education.map((edu) => (
                                        <div key={edu.id}>
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1">
                                                    <div className="font-semibold text-sm">{edu.degree} in {edu.fieldOfStudy}</div>
                                                    <div className="text-xs text-gray-700">{edu.institution}</div>
                                                </div>
                                                <div className="text-xs text-gray-700 whitespace-nowrap ml-4">
                                                    {formatDate(edu.startDate)} – {edu.current ? "Present" : formatDate(edu.endDate)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null;

                    case 'skills':
                        return skills.length > 0 ? (
                            <div key="skills" className="mb-4">
                                <h2 className="font-bold text-sm mb-1.5">SKILLS</h2>
                                <div className="text-xs leading-relaxed text-gray-800">
                                    {skills.map((skill, idx) => (
                                        <span key={skill}>
                                            {skill}{idx < skills.length - 1 ? ' • ' : ''}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : null;

                    default:
                        return null;
                }
            })}
        </div>
    );
}
