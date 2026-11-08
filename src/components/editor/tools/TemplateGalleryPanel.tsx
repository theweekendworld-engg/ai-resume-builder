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
import { TEMPLATE_OPTIONS, compactLinkLabel, dateRangeParts, isShortRole } from '@/templates/latex';
import { resolveSkillGroups } from '@/lib/resume/skillGroups';
import { contactLines, contactParts, projectLinks } from '@/lib/resume/contact';

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

/** Latin Modern, as the compact PDF is set; the CM web fonts if installed, else a close serif. */
const COMPACT_SERIF = '"Latin Modern Roman", "LM Roman 10", "CMU Serif", "Computer Modern Serif", Georgia, "Times New Roman", serif';

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

/**
 * A bullet list with its markers drawn explicitly. Tailwind's preflight sets
 * `list-style: none` on every `ul`, so a list that does not set its own
 * marker renders as plain lines: project bullets did, while the PDF printed
 * them as bullets.
 */
function BulletList({ items, dash, markerColor, style }: { items: string[]; dash: boolean; markerColor: string; style?: React.CSSProperties }) {
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: '2px 0 0', paddingLeft: 14, ...style }}>
      {items.map((b, i) => (
        <li key={i} style={{ color: '#333', marginBottom: 1, listStyleType: dash ? 'none' : 'disc' }}>
          {dash && <span style={{ color: markerColor, marginRight: 4 }}>–</span>}
          {b}
        </li>
      ))}
    </ul>
  );
}

/** Two cells on one line, the right one kept to its own width: the compact template's heading rows. */
function SplitRow({ left, right, style }: { left: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, ...style }}>
      <span style={{ minWidth: 0 }}>{left}</span>
      {right ? <span style={{ flexShrink: 0, maxWidth: '40%', textAlign: 'right' }}>{right}</span> : null}
    </div>
  );
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
  const t = theme.templateId;
  const isCompact = t === 'compact';
  const font = isCompact && theme.fontFamily === 'serif' ? COMPACT_SERIF : FONT_STACK[theme.fontFamily];
  const d = DENSITY_CSS[theme.density];
  const { personalInfo: pi } = data;
  const order = data.sectionOrder?.length ? data.sectionOrder : ['summary', 'experience', 'projects', 'education', 'skills'];
  const isThumb = variant === 'thumb';

  // Per-template knobs.
  const sectionRule = t === 'modern'; // underline rules under headings
  const uppercaseHeadings = t === 'ats-simple' || t === 'classic' || isCompact;
  const smallCaps = t === 'minimal';
  const centeredHeader = t === 'ats-simple' || t === 'modern' || isCompact;
  const serifClassic = t === 'classic' || (isCompact && theme.fontFamily === 'serif');
  // The thumbnail shows a taste of each entry; the full preview shows all of
  // it, as the PDF does.
  const cap = (items: string[], thumbLimit: number) => (isThumb ? items.slice(0, thumbLimit) : items);

  const headingStyle: React.CSSProperties = {
    color: t === 'minimal' || t === 'classic' ? '#222' : accent,
    fontWeight: 700,
    fontSize: isThumb ? 9 : isCompact ? 12 : 13,
    textTransform: uppercaseHeadings ? 'uppercase' : smallCaps ? 'lowercase' : 'none',
    fontVariant: smallCaps ? 'small-caps' : 'normal',
    letterSpacing: uppercaseHeadings ? 0.5 : smallCaps ? 1 : 0,
    borderBottom: sectionRule ? `1.5px solid ${accent}` : t === 'minimal' ? 'none' : 'none',
    paddingBottom: sectionRule ? 2 : 0,
    margin: 0,
    marginBottom: d.itemGap,
  };

  const bulletColor = t === 'modern' ? accent : t === 'minimal' ? '#888' : '#444';
  const dash = t === 'minimal';
  const dates = (start: string, end: string, current: boolean) =>
    isCompact
      ? dateRangeParts(start, end, current).join(' – ')
      : [start, current ? 'Present' : end].filter(Boolean).join(' – ');

  const link = (part: { label: string; href?: string }, key: number | string) =>
    part.href ? (
      <a key={key} href={part.href} target="_blank" rel="noreferrer noopener" style={{ color: accent, textDecoration: 'none' }}>
        {part.label}
      </a>
    ) : (
      <span key={key}>{part.label}</span>
    );

  /** The compact header: name, title, then place / phone / email and the links as printed addresses. */
  const renderCompactHeader = () => {
    const { details, links } = contactLines(pi);
    const line = (parts: typeof details, key: string) =>
      parts.length ? (
        <div key={key} style={{ fontSize: isThumb ? 6.5 : 11, color: '#222', marginTop: 2, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 6px' }}>
          {parts.flatMap((part, i) => [i > 0 ? <span key={`s${i}`} style={{ color: '#555' }}>|</span> : null, link(part, i)])}
        </div>
      ) : null;
    return (
      <div style={{ textAlign: 'center', marginBottom: d.sectionGap }}>
        <div style={{ fontSize: isThumb ? 14 : 24, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {pi.fullName || 'Your Name'}
        </div>
        {pi.title && <div style={{ fontSize: isThumb ? 8 : 12, fontStyle: 'italic', color: '#222', marginTop: 2 }}>{pi.title}</div>}
        {line(details, 'details')}
        {line(links, 'links')}
      </div>
    );
  };

  const renderHeader = () => isCompact ? renderCompactHeader() : (
    <div style={{ textAlign: centeredHeader ? 'center' : 'left', marginBottom: d.sectionGap }}>
      <div style={{ fontSize: isThumb ? 14 : 24, fontWeight: 800, color: t === 'minimal' ? '#111' : (centeredHeader && t === 'modern' ? accent : '#111') }}>
        {pi.fullName || 'Your Name'}
      </div>
      {pi.title && (
        <div style={{ fontSize: isThumb ? 8 : 12, color: '#666', marginTop: 2 }}>{pi.title}</div>
      )}
      {/*
        Real anchors, coloured like links.

        These used to render as dead text — `pi.linkedin && 'LinkedIn'` printed
        the word and threw the URL away, so the live preview showed a contact
        line nobody could click while the exported PDF had working `\href`s.
        Two renderers, two documents. A recruiter opening the PDF expects the
        profile links to work; so does anyone reading the preview.
      */}
      <div style={{ fontSize: isThumb ? 6.5 : 10, color: '#777', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px', justifyContent: centeredHeader ? 'center' : 'flex-start' }}>
        {contactParts(pi).map((part, i) =>
          part.href ? (
            <a
              key={i}
              href={part.href}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: accent, textDecoration: 'none' }}
            >
              {part.label}
            </a>
          ) : (
            <span key={i}>{part.label}</span>
          )
        )}
      </div>
    </div>
  );

  const section = (key: string, body: React.ReactNode) => (
    <div key={key} style={{ marginBottom: d.sectionGap }}>
      <div style={headingStyle}>{isCompact && key === 'summary' ? 'Summary' : SECTION_TITLES[key] ?? key}</div>
      {body}
    </div>
  );

  /** Mirrors `generateCompactTemplate` in src/templates/latex.ts, entry for entry. */
  const renderCompactSection = (key: string): React.ReactNode => {
    switch (key) {
      case 'experience':
        return data.experience.length
          ? section(
              'experience',
              <div style={{ display: 'flex', flexDirection: 'column', gap: d.itemGap }}>
                {data.experience.map((exp) => {
                  const bullets = plainBullets(exp.description);
                  const roleText = [exp.role, exp.stack].filter(Boolean).join(' | ');
                  const company = (
                    <>
                      <span style={{ fontWeight: 700, color: '#111' }}>{exp.company}</span>
                      {exp.companyNote ? <span style={{ fontSize: '0.9em' }}> ({exp.companyNote})</span> : null}
                    </>
                  );
                  if (isShortRole(exp)) {
                    // One line, as the PDF prints an internship.
                    const last = exp.stack?.trim() || exp.role?.trim() || '';
                    return (
                      <SplitRow
                        key={exp.id}
                        left={
                          <>
                            {company}
                            {roleText ? <>, <i>{roleText}</i></> : null}
                            {bullets[0] ? `${/[.:;!?]$/.test(last) ? '' : '.'} ${bullets[0]}` : null}
                          </>
                        }
                        right={<i>{[exp.location, dates(exp.startDate, exp.endDate, exp.current)].filter(Boolean).join(' | ')}</i>}
                      />
                    );
                  }
                  return (
                    <div key={exp.id}>
                      <SplitRow left={company} right={exp.location} />
                      <SplitRow left={<i>{roleText}</i>} right={<i>{dates(exp.startDate, exp.endDate, exp.current)}</i>} />
                      <BulletList items={cap(bullets, 2)} dash={false} markerColor={bulletColor} />
                    </div>
                  );
                })}
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
                    <SplitRow
                      left={
                        <>
                          <span style={{ fontWeight: 700, color: '#111' }}>{p.name || 'Project'}</span>
                          {p.technologies.length > 0 ? <> | <i>{p.technologies.join(', ')}</i></> : null}
                        </>
                      }
                      right={
                        projectLinks(p).length > 0 ? (
                          <>
                            {projectLinks(p).flatMap((l, i) => [
                              i > 0 ? ' | ' : null,
                              <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener" style={{ color: accent, textDecoration: 'none' }}>
                                {compactLinkLabel(l)}
                              </a>,
                            ])}
                          </>
                        ) : undefined
                      }
                    />
                    <BulletList items={cap(plainBullets(p.description), 1)} dash={false} markerColor={bulletColor} />
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
                  <div key={edu.id}>
                    <SplitRow left={<span style={{ fontWeight: 700, color: '#111' }}>{edu.institution}</span>} />
                    {(edu.degree || edu.fieldOfStudy || edu.startDate || edu.endDate) && (
                      <SplitRow
                        left={<i>{[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}</i>}
                        right={<i>{dates(edu.startDate, edu.endDate, edu.current)}</i>}
                      />
                    )}
                  </div>
                ))}
              </div>
            )
          : null;
      default:
        return undefined;
    }
  };

  const renderSection = (key: string): React.ReactNode => {
    if (isCompact) {
      const rendered = renderCompactSection(key);
      if (rendered !== undefined) return rendered;
    }
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
                      <span style={{ fontWeight: 700, color: '#222' }}>
                        {exp.role || 'Role'}
                        {exp.stack ? <span style={{ fontWeight: 400 }}> | {exp.stack}</span> : null}
                      </span>
                      <span style={{ color: '#888', whiteSpace: 'nowrap' }}>
                        {dates(exp.startDate, exp.endDate, exp.current)}
                      </span>
                    </div>
                    <div style={{ color: t === 'modern' ? accent : '#555' }}>
                      {[exp.companyNote ? `${exp.company} (${exp.companyNote})` : exp.company, exp.location]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    <BulletList items={cap(plainBullets(exp.description), 2)} dash={dash} markerColor={bulletColor} />
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
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{ fontWeight: 700, color: '#222' }}>{p.name || 'Project'}</span>
                      {/*
                        The PDF has rendered these in blue for as long as it has
                        existed; the preview rendered nothing, so a repo link
                        only appeared in the exported document.
                      */}
                      {projectLinks(p).map((link) => (
                        <a
                          key={link.label}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          style={{ color: accent, textDecoration: 'none', fontWeight: 500 }}
                        >
                          [{link.label}]
                        </a>
                      ))}
                    </div>
                    <BulletList items={cap(plainBullets(p.description), 1)} dash={dash} markerColor={bulletColor} />
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
      case 'skills': {
        // Was `data.skills.join(' · ')` — one undifferentiated run of text,
        // which is what the user was looking at while the LaTeX export grouped
        // them properly. Same grouping in both now.
        // The resume's own rows ("Speech / AI: …") when it has them.
        const groups = resolveSkillGroups(data);
        if (groups.length === 0) return null;
        return section(
          'skills',
          <div style={{ color: '#333' }}>
            {groups.map((group) => (
              <div key={group.label || 'all'} style={{ marginBottom: 2 }}>
                {group.label ? (
                  <span style={{ fontWeight: 700, color: '#111' }}>{group.label}: </span>
                ) : null}
                {group.skills.join(', ')}
              </div>
            ))}
          </div>
        );
      }
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
// Template gallery — visual picker of the templates.
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
