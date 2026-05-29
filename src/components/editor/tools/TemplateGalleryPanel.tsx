'use client';

import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResumeStore } from '@/store/resumeStore';
import {
  ResumeData,
  ResumeTheme,
  ResumeTemplateId,
  ResumeFontFamily,
} from '@/types/resume';
import { TEMPLATE_OPTIONS } from '@/templates/latex';

// ---------------------------------------------------------------------------
// Shared client-side HTML approximation of a template + theme.
// This is NOT the export artifact (that comes from LaTeX compilation); it is a
// fast, honest, sc-aled CSS mock rendered from the user's OWN data so the
// preview and gallery thumbnails update instantly as the theme changes.
// ---------------------------------------------------------------------------

const FONT_STACK: Record<ResumeFontFamily, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

interface DensityCss {
  padding: string;
  lineHeight: number;
  sectionGap: string;
  itemGap: string;
}

const DENSITY_CSS: Record<ResumeTheme['density'], DensityCss> = {
  compact: { padding: '20px 24px', lineHeight: 1.25, sectionGap: '10px', itemGap: '4px' },
  normal: { padding: '28px 32px', lineHeight: 1.4, sectionGap: '16px', itemGap: '6px' },
  relaxed: { padding: '44px 48px', lineHeight: 1.6, sectionGap: '24px', itemGap: '10px' },
};

const SECTION_TITLES: Record<string, string> = {
  summary: 'About',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
};

function plainBullets(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/<\/?(ul|li|br\s*\/?)>/gi, '\n')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .split('\n')
    .flatMap((l) => l.split(/\s*[•●]\s+/g))
    .map((l) => l.replace(/^[•\-*]+\s*/, '').trim())
    .filter(Boolean);
}

interface ResumeHtmlPreviewProps {
  data: ResumeData;
  theme: ResumeTheme;
  /** Render a non-interactive, scaled thumbnail (used by the gallery cards). */
  variant?: 'full' | 'thumb';
  className?: string;
}

/**
 * Renders a styled HTML approximation of the resume for the given theme.
 * Visual treatment is intentionally distinct per `templateId` while staying
 * faithful to the LaTeX layout each template produces.
 */
export function ResumeHtmlPreview({ data, theme, variant = 'full', className }: ResumeHtmlPreviewProps) {
  const accent = theme.accentColor;
  const font = FONT_STACK[theme.fontFamily];
  const d = DENSITY_CSS[theme.density];
  const { personalInfo: pi } = data;
  const order = data.sectionOrder?.length ? data.sectionOrder : ['summary', 'experience', 'projects', 'education', 'skills'];
  const isThumb = variant === 'thumb';

  // Per-template knobs.
  const t = theme.templateId;
  const sectionRule = t === 'modern'; // underline rules under headings
  const uppercaseHeadings = t === 'ats-simple' || t === 'classic';
  const smallCaps = t === 'minimal';
  const centeredHeader = t === 'ats-simple' || t === 'modern';
  const serifClassic = t === 'classic';

  const headingStyle: React.CSSProperties = {
    color: t === 'minimal' || t === 'classic' ? '#222' : accent,
    fontWeight: 700,
    fontSize: isThumb ? 9 : 13,
    textTransform: uppercaseHeadings ? 'uppercase' : smallCaps ? 'lowercase' : 'none',
    fontVariant: smallCaps ? 'small-caps' : 'normal',
    letterSpacing: uppercaseHeadings ? 0.5 : smallCaps ? 1 : 0,
    borderBottom: sectionRule ? `1.5px solid ${accent}` : t === 'minimal' ? 'none' : 'none',
    paddingBottom: sectionRule ? 2 : 0,
    margin: 0,
    marginBottom: d.itemGap,
  };

  const bulletColor = t === 'modern' ? accent : t === 'minimal' ? '#888' : '#444';

  const renderHeader = () => (
    <div style={{ textAlign: centeredHeader ? 'center' : 'left', marginBottom: d.sectionGap }}>
      <div style={{ fontSize: isThumb ? 14 : 24, fontWeight: 800, color: t === 'minimal' ? '#111' : (centeredHeader && t === 'modern' ? accent : '#111') }}>
        {pi.fullName || 'Your Name'}
      </div>
      {pi.title && (
        <div style={{ fontSize: isThumb ? 8 : 12, color: '#666', marginTop: 2 }}>{pi.title}</div>
      )}
      <div style={{ fontSize: isThumb ? 6.5 : 10, color: '#777', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px', justifyContent: centeredHeader ? 'center' : 'flex-start' }}>
        {[pi.location, pi.email, pi.phone, pi.linkedin && 'LinkedIn', pi.github && 'GitHub', pi.website && 'Portfolio']
          .filter(Boolean)
          .map((c, i) => (
            <span key={i}>{c}</span>
          ))}
      </div>
    </div>
  );

  const section = (key: string, body: React.ReactNode) => (
    <div key={key} style={{ marginBottom: d.sectionGap }}>
      <div style={headingStyle}>{SECTION_TITLES[key] ?? key}</div>
      {body}
    </div>
  );

  const renderSection = (key: string): React.ReactNode => {
    switch (key) {
      case 'summary':
        return pi.summary ? section('summary', <div style={{ color: '#333' }}>{pi.summary}</div>) : null;
      case 'experience':
        return data.experience.length
          ? section(
              'experience',
              <div style={{ display: 'flex', flexDirection: 'column', gap: d.itemGap }}>
                {data.experience.map((exp) => (
                  <div key={exp.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: '#222' }}>{exp.role || 'Role'}</span>
                      <span style={{ color: '#888', whiteSpace: 'nowrap' }}>
                        {[exp.startDate, exp.current ? 'Present' : exp.endDate].filter(Boolean).join(' – ')}
                      </span>
                    </div>
                    <div style={{ color: t === 'modern' ? accent : '#555' }}>
                      {[exp.company, exp.location].filter(Boolean).join(', ')}
                    </div>
                    <ul style={{ margin: '2px 0 0', paddingLeft: 14 }}>
                      {plainBullets(exp.description).slice(0, isThumb ? 2 : 6).map((b, i) => (
                        <li key={i} style={{ color: '#333', marginBottom: 1, listStyleType: t === 'minimal' ? 'none' : 'disc' }}>
                          {t === 'minimal' && <span style={{ color: bulletColor, marginRight: 4 }}>–</span>}
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          : null;
      case 'projects':
        return data.projects.length
          ? section(
              'projects',
              <div style={{ display: 'flex', flexDirection: 'column', gap: d.itemGap }}>
                {data.projects.map((p) => (
                  <div key={p.id}>
                    <div style={{ fontWeight: 700, color: '#222' }}>{p.name || 'Project'}</div>
                    <ul style={{ margin: '2px 0 0', paddingLeft: 14 }}>
                      {plainBullets(p.description).slice(0, isThumb ? 1 : 4).map((b, i) => (
                        <li key={i} style={{ color: '#333' }}>{b}</li>
                      ))}
                    </ul>
                    {p.technologies.length > 0 && (
                      <div style={{ color: '#888', fontStyle: 'italic', marginTop: 1 }}>
                        {p.technologies.join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          : null;
      case 'education':
        return data.education.length
          ? section(
              'education',
              <div style={{ display: 'flex', flexDirection: 'column', gap: d.itemGap }}>
                {data.education.map((edu) => (
                  <div key={edu.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>
                      <span style={{ fontWeight: 700, color: '#222' }}>
                        {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}
                      </span>
                      <span style={{ color: '#666' }}> — {edu.institution}</span>
                    </span>
                    <span style={{ color: '#888', whiteSpace: 'nowrap' }}>
                      {[edu.startDate, edu.current ? 'Present' : edu.endDate].filter(Boolean).join(' – ')}
                    </span>
                  </div>
                ))}
              </div>
            )
          : null;
      case 'skills':
        return data.skills.length
          ? section('skills', <div style={{ color: '#333' }}>{data.skills.join(' · ')}</div>)
          : null;
      default:
        return null;
    }
  };

  const hasContent = pi.fullName || data.experience.length || data.projects.length || data.education.length || data.skills.length || pi.summary;

  return (
    <div
      className={className}
      style={{
        fontFamily: font,
        fontSize: isThumb ? 6.5 : 11,
        lineHeight: d.lineHeight,
        color: '#222',
        background: '#fff',
        padding: isThumb ? '12px 14px' : d.padding,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        textRendering: 'optimizeLegibility',
        fontVariantLigatures: serifClassic ? 'common-ligatures' : 'normal',
      }}
    >
      {renderHeader()}
      {!hasContent && (
        <div style={{ color: '#999', fontSize: isThumb ? 7 : 11 }}>
          Add your details to see them previewed here.
        </div>
      )}
      {order.map((s) => renderSection(s))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template gallery — visual picker of the four templates.
// ---------------------------------------------------------------------------

function ThumbCard({
  templateId,
  label,
  description,
  data,
  theme,
  selected,
  onSelect,
}: {
  templateId: ResumeTemplateId;
  label: string;
  description: string;
  data: ResumeData;
  theme: ResumeTheme;
  selected: boolean;
  onSelect: () => void;
}) {
  // Thumbnail uses the user's data + current accent/font/density but THIS card's template.
  const cardTheme = useMemo<ResumeTheme>(() => ({ ...theme, templateId }), [theme, templateId]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/50'
      )}
    >
      <div className="relative h-44 w-full overflow-hidden border-b border-border bg-white">
        <div className="pointer-events-none origin-top-left" style={{ transform: 'scale(1)', width: '100%', height: '100%' }}>
          <ResumeHtmlPreview data={data} theme={cardTheme} variant="thumb" />
        </div>
        {selected && (
          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

export function TemplateGalleryPanel() {
  const { resumeData, theme, setTemplateId } = useResumeStore();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {TEMPLATE_OPTIONS.map((opt) => (
        <ThumbCard
          key={opt.value}
          templateId={opt.value as ResumeTemplateId}
          label={opt.label}
          description={opt.description}
          data={resumeData}
          theme={theme}
          selected={theme.templateId === opt.value}
          onSelect={() => setTemplateId(opt.value as ResumeTemplateId)}
        />
      ))}
    </div>
  );
}
