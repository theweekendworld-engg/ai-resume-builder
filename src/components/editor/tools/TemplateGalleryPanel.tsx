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
  CanonicalTemplateId,
  EducationItem,
  ExperienceItem,
  ProjectItem,
  canonicalTemplateId,
  switchTemplate,
} from '@/types/resume';
import {
  TEMPLATE_OPTIONS,
  compactLinkLabel,
  dateRangeParts,
  fullDateRangeParts,
  isShortRole,
  lastOfCompanyFirst,
  sentenceStop,
} from '@/templates/latex';
import { resolveSkillGroups } from '@/lib/resume/skillGroups';
import { contactLines, projectLinks, type ContactPart } from '@/lib/resume/contact';

// ---------------------------------------------------------------------------
// Shared client-side HTML approximation of a template + theme.
// This is NOT the export artifact (that comes from LaTeX compilation); it is a
// fast, honest, scaled CSS mock rendered from the user's OWN data so the
// preview and gallery thumbnails update instantly as the theme changes.
//
// Each template below mirrors its LaTeX in src/templates/latex.ts cell for
// cell: the same fields in the same rows, the same dates, the same section
// names, the same skills layout. Only the faces are approximations: the PDF
// embeds Latin Modern, Libertinus, IBM Plex, Source Sans or Lato, and the
// browser uses them when installed, else the nearest system face.
// ---------------------------------------------------------------------------

/** Latin Modern, as the compact PDF is set; the CM web fonts if installed, else a close serif. */
const COMPACT_SERIF = '"Latin Modern Roman", "LM Roman 10", "CMU Serif", "Computer Modern Serif", Georgia, "Times New Roman", serif';

const SYSTEM_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SYSTEM_SERIF = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, "Times New Roman", serif';
const SYSTEM_MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Each template's three faces, as the LaTeX loads them. */
const FONTS: Record<CanonicalTemplateId, Record<ResumeFontFamily, string>> = {
  compact: {
    serif: COMPACT_SERIF,
    sans: `"Latin Modern Sans", "LM Sans 10", "CMU Sans Serif", ${SYSTEM_SANS}`,
    mono: `"Bera Sans Mono", "DejaVu Sans Mono", ${SYSTEM_MONO}`,
  },
  executive: {
    serif: `"Libertinus Serif", "Linux Libertine O", "Linux Libertine", Georgia, "Times New Roman", serif`,
    sans: `"Libertinus Sans", "Linux Biolinum O", "Linux Biolinum", ${SYSTEM_SANS}`,
    mono: `"Libertinus Mono", ${SYSTEM_MONO}`,
  },
  tech: {
    sans: `"IBM Plex Sans", ${SYSTEM_SANS}`,
    serif: `"IBM Plex Serif", ${SYSTEM_SERIF}`,
    mono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
  },
  minimal: {
    sans: `"Source Sans 3", "Source Sans Pro", ${SYSTEM_SANS}`,
    serif: `"Source Serif 4", "Source Serif Pro", ${SYSTEM_SERIF}`,
    mono: `"Bera Sans Mono", "DejaVu Sans Mono", ${SYSTEM_MONO}`,
  },
  'ats-simple': {
    sans: `Lato, "Helvetica Neue", Arial, sans-serif`,
    serif: SYSTEM_SERIF,
    mono: `"Bera Sans Mono", "DejaVu Sans Mono", ${SYSTEM_MONO}`,
  },
};

interface DensityCss {
  padding: string;
  lineHeight: number;
  sectionGap: string;
  itemGap: string;
}

const DENSITY_CSS: Record<ResumeTheme['density'], DensityCss> = {
  compact: { padding: '20px 24px', lineHeight: 1.25, sectionGap: '10px', itemGap: '4px' },
  normal: { padding: '28px 32px', lineHeight: 1.35, sectionGap: '14px', itemGap: '6px' },
  relaxed: { padding: '44px 48px', lineHeight: 1.55, sectionGap: '22px', itemGap: '10px' },
};

const INK = '#111827';
const MUTED = '#4B5563';
const HAIRLINE = '#D1D5DB';

const SECTION_TITLES: Record<string, string> = {
  summary: 'Summary',
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
        // The li's colour is the marker's; the text sets its own.
        <li key={i} style={{ color: dash ? '#333' : markerColor, marginBottom: 1, listStyleType: dash ? 'none' : 'disc' }}>
          {dash && <span style={{ color: markerColor, marginLeft: -10, marginRight: 4 }}>–</span>}
          <span style={{ color: '#333' }}>{b}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two cells on one line, the right one kept to its own width: every template's heading rows. */
function SplitRow({ left, right, style }: { left: React.ReactNode; right?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, ...style }}>
      <span style={{ minWidth: 0 }}>{left}</span>
      {right ? <span style={{ flexShrink: 0, maxWidth: '40%', textAlign: 'right' }}>{right}</span> : null}
    </div>
  );
}

const muted = (text: React.ReactNode) => <span style={{ color: MUTED }}>{text}</span>;
const bold = (text: React.ReactNode) => <span style={{ fontWeight: 700, color: '#111' }}>{text}</span>;
const smallCaps = (text: React.ReactNode) => <span style={{ fontVariant: 'small-caps' }}>{text}</span>;
const join = (parts: Array<string | undefined>, separator: string) => parts.map((p) => p?.trim()).filter(Boolean).join(separator);

interface Cells {
  l1: React.ReactNode;
  r1?: React.ReactNode;
  l2?: React.ReactNode;
  r2?: React.ReactNode;
}

interface Row {
  left: React.ReactNode;
  right?: React.ReactNode;
}

interface LookContext {
  accent: string;
  link: (part: { label: string; href?: string }, key: number | string) => React.ReactNode;
}

/** How one template sets the page; mirrors its `DesignedTemplate` (or the compact template) in latex.ts. */
interface Look {
  header: (pi: ResumeData['personalInfo'], ctx: LookContext) => React.ReactNode;
  heading: (accent: string) => React.CSSProperties;
  /** Tech's heading runs a hairline to the margin. */
  headingRule?: boolean;
  dates: (start: string, end: string, current: boolean) => string;
  role: (exp: ExperienceItem, dates: string, accent: string) => Cells;
  shortRole: (exp: ExperienceItem, sentence: string, dates: string, accent: string) => Row;
  project: (p: ProjectItem, links: React.ReactNode) => Row;
  education: (edu: EducationItem, degree: string, dates: string) => Cells;
  /** Separator between a project's links. */
  linkSeparator: string;
  skillsTable: boolean;
  bullet: (accent: string) => { dash: boolean; color: string };
}

const compactDates = (start: string, end: string, current: boolean) => dateRangeParts(start, end, current).join(' – ');
const fullDates = (start: string, end: string, current: boolean) => fullDateRangeParts(start, end, current).join(' – ');

/** A header's contact lines: place, phone, email, then the links as printed addresses. */
function ContactLines({ pi, ctx, separator, color, align, fontSize = '0.92em' }: { pi: ResumeData['personalInfo']; ctx: LookContext; separator: React.ReactNode; color: string; align: 'center' | 'flex-start'; fontSize?: string }) {
  const { details, links } = contactLines(pi);
  const line = (parts: ContactPart[], key: string) =>
    parts.length ? (
      <div key={key} style={{ fontSize, color, marginTop: 2, display: 'flex', flexWrap: 'wrap', justifyContent: align, gap: '0 6px' }}>
        {parts.flatMap((part, i) => [i > 0 ? <span key={`s${i}`}>{separator}</span> : null, ctx.link(part, i)])}
      </div>
    ) : null;
  return (
    <>
      {line(details, 'details')}
      {line(links, 'links')}
    </>
  );
}

const LOOKS: Record<CanonicalTemplateId, Look> = {
  /** Mirrors `generateCompactTemplate`, entry for entry. */
  compact: {
    header: (pi, ctx) => (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.2em', fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: 0.5 }}>{pi.fullName || 'Your Name'}</div>
        {pi.title && <div style={{ fontStyle: 'italic', color: '#222', marginTop: 2 }}>{pi.title}</div>}
        <ContactLines pi={pi} ctx={ctx} separator={<span style={{ color: '#555' }}>|</span>} color="#222" align="center" fontSize="1em" />
      </div>
    ),
    heading: (accent) => ({ color: accent, fontWeight: 700, fontSize: '1.09em', textTransform: 'uppercase', letterSpacing: 0.5 }),
    dates: compactDates,
    role: (exp, dates) => ({
      l1: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? <span style={{ fontSize: '0.9em' }}> ({exp.companyNote})</span> : null}
        </>
      ),
      r1: exp.location,
      l2: <i>{join([exp.role, exp.stack], ' | ')}</i>,
      r2: <i>{dates}</i>,
    }),
    shortRole: (exp, sentence, dates) => {
      const roleText = join([exp.role, exp.stack], ' | ');
      return {
        left: (
          <>
            {bold(exp.company)}
            {exp.companyNote ? <span style={{ fontSize: '0.9em' }}> ({exp.companyNote})</span> : null}
            {roleText ? <>, <i>{roleText}</i></> : null}
            {sentence ? `${sentenceStop(lastOfCompanyFirst(exp))} ${sentence}` : null}
          </>
        ),
        right: <i>{join([exp.location, dates], ' | ')}</i>,
      };
    },
    project: (p, links) => ({
      left: (
        <>
          {bold(p.name || 'Project')}
          {p.technologies.length > 0 ? <> | <i>{p.technologies.join(', ')}</i></> : null}
        </>
      ),
      right: links,
    }),
    education: (edu, degree, dates) => (degree || dates ? { l1: bold(edu.institution), l2: <i>{degree}</i>, r2: <i>{dates}</i> } : { l1: bold(edu.institution) }),
    linkSeparator: ' | ',
    skillsTable: false,
    bullet: () => ({ dash: false, color: '#444' }),
  },

  executive: {
    header: (pi, ctx) => (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.4em', fontVariant: 'small-caps', color: '#1A1A1A', lineHeight: 1.15 }}>{pi.fullName || 'Your Name'}</div>
        {pi.title && <div style={{ fontStyle: 'italic', marginTop: 3 }}>{pi.title}</div>}
        <ContactLines pi={pi} ctx={ctx} separator="·" color="#222" align="center" />
      </div>
    ),
    heading: (accent) => ({ color: accent, fontSize: '1.2em', fontVariant: 'small-caps', borderBottom: `0.5px solid ${accent}`, paddingBottom: 1 }),
    dates: fullDates,
    role: (exp, dates) => ({
      l1: (
        <>
          {bold(exp.role)}
          {exp.stack ? <span style={{ fontSize: '0.9em' }}> | {exp.stack}</span> : null}
        </>
      ),
      r1: dates,
      l2: (
        <>
          {smallCaps(exp.company)}
          {exp.companyNote ? <i style={{ fontSize: '0.9em' }}> ({exp.companyNote})</i> : null}
        </>
      ),
      r2: exp.location ? <i>{exp.location}</i> : undefined,
    }),
    shortRole: (exp, sentence, dates) => ({
      left: (
        <>
          {exp.role ? bold(exp.role) : null}
          {exp.stack ? <span style={{ fontSize: '0.9em' }}> | {exp.stack}</span> : null}
          {exp.role || exp.stack ? ', ' : null}
          {smallCaps(exp.company)}
          {exp.companyNote ? <i style={{ fontSize: '0.9em' }}> ({exp.companyNote})</i> : null}
          {sentence ? `${sentenceStop(exp.companyNote?.trim() ? ')' : exp.company ?? '')} ${sentence}` : null}
        </>
      ),
      right: (
        <>
          {exp.location ? <i>{exp.location}</i> : null}
          {exp.location && dates ? ' | ' : null}
          {dates}
        </>
      ),
    }),
    project: (p, links) => ({
      left: (
        <>
          {bold(p.name || 'Project')}
          {p.technologies.length > 0 ? <span style={{ fontSize: '0.9em' }}> | <i>{p.technologies.join(', ')}</i></span> : null}
        </>
      ),
      right: links ? <span style={{ fontSize: '0.9em' }}>{links}</span> : undefined,
    }),
    education: (edu, degree, dates) =>
      degree ? { l1: bold(degree), r1: dates, l2: smallCaps(edu.institution) } : { l1: smallCaps(edu.institution), r1: dates },
    linkSeparator: ' | ',
    skillsTable: false,
    bullet: () => ({ dash: false, color: '#333' }),
  },

  tech: {
    header: (pi, ctx) => (
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: '2em', fontWeight: 700, color: INK, lineHeight: 1.15 }}>{pi.fullName || 'Your Name'}</div>
        {pi.title && <div style={{ fontSize: '1.2em', color: ctx.accent, marginTop: 1 }}>{pi.title}</div>}
        <ContactLines pi={pi} ctx={ctx} separator={<span style={{ color: HAIRLINE }}>|</span>} color={MUTED} align="flex-start" />
      </div>
    ),
    heading: (accent) => ({ color: accent, fontWeight: 700, fontSize: '0.92em', textTransform: 'uppercase' }),
    headingRule: true,
    dates: fullDates,
    role: (exp, dates, accent) => ({
      l1: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? <span style={{ fontSize: '0.9em', color: MUTED }}> ({exp.companyNote})</span> : null}
        </>
      ),
      r1: muted(dates),
      l2: (
        <>
          <span style={{ color: accent }}>{exp.role}</span>
          {exp.stack ? muted(`${exp.role ? ' ' : ''}| ${exp.stack}`) : null}
        </>
      ),
      r2: exp.location ? muted(exp.location) : undefined,
    }),
    shortRole: (exp, sentence, dates, accent) => ({
      left: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? <span style={{ fontSize: '0.9em', color: MUTED }}> ({exp.companyNote})</span> : null}
          {exp.role || exp.stack ? <>, <span style={{ color: accent }}>{join([exp.role, exp.stack], ' | ')}</span></> : null}
          {sentence ? `${sentenceStop(lastOfCompanyFirst(exp))} ${sentence}` : null}
        </>
      ),
      right: muted(join([exp.location, dates], ' | ')),
    }),
    project: (p, links) => ({
      left: (
        <>
          {bold(p.name || 'Project')}
          {p.technologies.length > 0 ? muted(` | ${p.technologies.join(', ')}`) : null}
        </>
      ),
      right: links,
    }),
    education: (edu, degree, dates) => ({ l1: bold(edu.institution), r1: muted(dates), l2: degree || undefined }),
    linkSeparator: ' | ',
    skillsTable: true,
    bullet: (accent) => ({ dash: false, color: accent }),
  },

  minimal: {
    header: (pi, ctx) => (
      <div style={{ textAlign: 'left' }}>
        <div style={{ fontSize: '2.55em', fontWeight: 300, color: ctx.accent, lineHeight: 1.1 }}>{pi.fullName || 'Your Name'}</div>
        {pi.title && <div style={{ fontSize: '1.2em', color: MUTED, marginTop: 2, marginBottom: 4 }}>{pi.title}</div>}
        <ContactLines pi={pi} ctx={ctx} separator={<span style={{ color: MUTED }}>/</span>} color="#222" align="flex-start" />
      </div>
    ),
    heading: () => ({ color: INK, fontWeight: 700, fontSize: '1.2em' }),
    dates: fullDates,
    role: (exp, dates) => ({
      l1: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? muted(` (${exp.companyNote})`) : null}
        </>
      ),
      r1: exp.location ? muted(exp.location) : undefined,
      l2: (
        <>
          {exp.role}
          {exp.role && exp.stack ? muted(' | ') : null}
          {exp.stack ? muted(exp.stack) : null}
        </>
      ),
      r2: muted(dates),
    }),
    shortRole: (exp, sentence, dates) => ({
      left: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? muted(` (${exp.companyNote})`) : null}
          {exp.role || exp.stack ? `, ${join([exp.role, exp.stack], ' | ')}` : null}
          {sentence ? `${sentenceStop(lastOfCompanyFirst(exp))} ${sentence}` : null}
        </>
      ),
      right: muted(join([exp.location, dates], ' | ')),
    }),
    project: (p, links) => ({
      left: (
        <>
          {bold(p.name || 'Project')}
          {p.technologies.length > 0 ? muted(` | ${p.technologies.join(', ')}`) : null}
        </>
      ),
      right: links ? muted(links) : undefined,
    }),
    education: (edu, degree, dates) => (degree ? { l1: bold(edu.institution), l2: degree, r2: muted(dates) } : { l1: bold(edu.institution), r1: muted(dates) }),
    linkSeparator: ' | ',
    skillsTable: false,
    bullet: () => ({ dash: true, color: MUTED }),
  },

  'ats-simple': {
    header: (pi, ctx) => (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.9em', fontWeight: 700, color: '#000' }}>{pi.fullName || 'Your Name'}</div>
        {pi.title && <div style={{ marginTop: 2 }}>{pi.title}</div>}
        <ContactLines pi={pi} ctx={ctx} separator="|" color="#000" align="center" fontSize="1em" />
      </div>
    ),
    heading: (accent) => ({ color: accent, fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid #000', paddingBottom: 1 }),
    dates: fullDates,
    role: (exp, dates) => ({
      l1: (
        <>
          {bold(exp.company)}
          {exp.companyNote ? ` (${exp.companyNote})` : null}
        </>
      ),
      r1: exp.location,
      l2: <i>{join([exp.role, exp.stack], ' | ')}</i>,
      r2: <i>{dates}</i>,
    }),
    shortRole: (exp, sentence, dates) => {
      const roleText = join([exp.role, exp.stack], ' | ');
      return {
        left: (
          <>
            {bold(exp.company)}
            {exp.companyNote ? ` (${exp.companyNote})` : null}
            {roleText ? <>, <i>{roleText}</i></> : null}
            {sentence ? `${sentenceStop(lastOfCompanyFirst(exp))} ${sentence}` : null}
          </>
        ),
        right: <i>{join([exp.location, dates], ' | ')}</i>,
      };
    },
    project: (p, links) => ({
      left: (
        <>
          {bold(p.name || 'Project')}
          {p.technologies.length > 0 ? <> | <i>{p.technologies.join(', ')}</i></> : null}
        </>
      ),
      right: links,
    }),
    education: (edu, degree, dates) => (degree ? { l1: bold(edu.institution), l2: <i>{degree}</i>, r2: <i>{dates}</i> } : { l1: bold(edu.institution), r1: <i>{dates}</i> }),
    linkSeparator: ' | ',
    skillsTable: false,
    bullet: () => ({ dash: false, color: '#000' }),
  },
};

interface ResumeHtmlPreviewProps {
  data: ResumeData;
  theme: ResumeTheme;
  /** Render a non-interactive, scaled thumbnail (used by the gallery cards). */
  variant?: 'full' | 'thumb';
  className?: string;
}

/**
 * Renders a styled HTML approximation of the resume for the given theme.
 * Each template's rows, dates, section names and skills layout follow the
 * LaTeX it produces (see `LOOKS`).
 */
export function ResumeHtmlPreview({ data, theme, variant = 'full', className }: ResumeHtmlPreviewProps) {
  const accent = theme.accentColor;
  const t = canonicalTemplateId(theme.templateId);
  const look = LOOKS[t];
  const font = FONTS[t][theme.fontFamily] ?? FONTS[t].sans;
  const d = DENSITY_CSS[theme.density] ?? DENSITY_CSS.normal;
  const { personalInfo: pi } = data;
  const order = data.sectionOrder?.length ? data.sectionOrder : ['summary', 'experience', 'projects', 'education', 'skills'];
  const isThumb = variant === 'thumb';
  // The thumbnail shows a taste of each entry; the full preview shows all of
  // it, as the PDF does.
  const cap = (items: string[], thumbLimit: number) => (isThumb ? items.slice(0, thumbLimit) : items);
  const bullet = look.bullet(accent);
  const linkColor = t === 'minimal' ? INK : t === 'ats-simple' ? '#000' : accent;

  const link = (part: { label: string; href?: string }, key: number | string) =>
    part.href ? (
      <a key={key} href={part.href} target="_blank" rel="noreferrer noopener" style={{ color: linkColor, textDecoration: 'none' }}>
        {part.label}
      </a>
    ) : (
      <span key={key}>{part.label}</span>
    );
  const ctx: LookContext = { accent, link };

  const headingStyle: React.CSSProperties = { margin: 0, marginBottom: d.itemGap, ...look.heading(accent) };
  const section = (key: string, body: React.ReactNode) => {
    const title = SECTION_TITLES[key] ?? key;
    return (
      <div key={key} style={{ marginBottom: d.sectionGap }}>
        {look.headingRule ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: d.itemGap }}>
            <div style={{ ...headingStyle, marginBottom: 0 }}>{title}</div>
            <span style={{ flex: 1, borderTop: `1px solid ${HAIRLINE}` }} />
          </div>
        ) : (
          <div style={headingStyle}>{title}</div>
        )}
        {body}
      </div>
    );
  };
  const entries = (children: React.ReactNode) => <div style={{ display: 'flex', flexDirection: 'column', gap: d.itemGap }}>{children}</div>;
  const rows = (cells: Cells) => (
    <>
      <SplitRow left={cells.l1} right={cells.r1} />
      {cells.l2 || cells.r2 ? <SplitRow left={cells.l2} right={cells.r2} /> : null}
    </>
  );

  const renderSection = (key: string): React.ReactNode => {
    switch (key) {
      case 'summary':
        return pi.summary ? section('summary', <div style={{ color: '#333' }}>{pi.summary}</div>) : null;
      case 'experience':
        return data.experience.length
          ? section(
              'experience',
              entries(
                data.experience.map((exp) => {
                  const bullets = plainBullets(exp.description);
                  const dates = look.dates(exp.startDate, exp.endDate, exp.current);
                  if (isShortRole(exp)) {
                    // One line, as the PDF prints an internship.
                    const row = look.shortRole(exp, bullets[0] ?? '', dates, accent);
                    return <SplitRow key={exp.id} left={row.left} right={row.right} />;
                  }
                  return (
                    <div key={exp.id}>
                      {rows(look.role(exp, dates, accent))}
                      <BulletList items={cap(bullets, 2)} dash={bullet.dash} markerColor={bullet.color} />
                    </div>
                  );
                })
              )
            )
          : null;
      case 'projects':
        return data.projects.length
          ? section(
              'projects',
              entries(
                data.projects.map((p) => {
                  const links = projectLinks(p);
                  const linkNodes = links.length
                    ? links.flatMap((l, i) => [
                        i > 0 ? look.linkSeparator : null,
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer noopener" style={{ color: linkColor, textDecoration: 'none' }}>
                          {compactLinkLabel(l)}
                        </a>,
                      ])
                    : null;
                  const row = look.project(p, linkNodes);
                  return (
                    <div key={p.id}>
                      <SplitRow left={row.left} right={row.right ?? undefined} />
                      <BulletList items={cap(plainBullets(p.description), 1)} dash={bullet.dash} markerColor={bullet.color} />
                    </div>
                  );
                })
              )
            )
          : null;
      case 'education':
        return data.education.length
          ? section(
              'education',
              entries(
                data.education.map((edu) => (
                  <div key={edu.id}>{rows(look.education(edu, join([edu.degree, edu.fieldOfStudy], ', '), look.dates(edu.startDate, edu.endDate, edu.current)))}</div>
                ))
              )
            )
          : null;
      case 'skills': {
        // The resume's own rows ("Speech / AI: …") when it has them, grouped
        // the same way as the PDF.
        const groups = resolveSkillGroups(data);
        if (groups.length === 0) return null;
        const asTable = look.skillsTable && groups.every((group) => group.label.trim().length <= 24);
        if (asTable) {
          return section(
            'skills',
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '1em', rowGap: 1, color: '#333' }}>
              {groups.map((group) => [
                <span key={`l-${group.label}`} style={{ fontWeight: 700, color: '#111' }}>{group.label ? `${group.label}:` : ''}</span>,
                <span key={`s-${group.label}`}>{group.skills.join(', ')}</span>,
              ])}
            </div>
          );
        }
        return section(
          'skills',
          <div style={{ color: '#333' }}>
            {groups.map((group) => (
              <div key={group.label || 'all'} style={{ marginBottom: 1 }}>
                {group.label ? <span style={{ fontWeight: 700, color: '#111' }}>{group.label}: </span> : null}
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
      data-template={t}
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
        fontVariantLigatures: 'common-ligatures',
      }}
    >
      <div style={{ marginBottom: d.sectionGap }}>{look.header(pi, ctx)}</div>
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
  // The thumbnail is what picking this card gives: the user's data, their
  // own accent/face/density where they set one, else this template's own.
  const cardTheme = useMemo<ResumeTheme>(() => switchTemplate(theme, templateId), [theme, templateId]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
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

/** The cards themselves, for a given resume and theme. */
export function TemplateGallery({ data, theme, onSelect }: { data: ResumeData; theme: ResumeTheme; onSelect: (templateId: ResumeTemplateId) => void }) {
  // A resume saved in a retired template (`modern`, `classic`) shows the
  // card of the template it renders as.
  const current = canonicalTemplateId(theme.templateId);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {TEMPLATE_OPTIONS.map((opt) => (
        <ThumbCard
          key={opt.value}
          templateId={opt.value}
          label={opt.label}
          description={opt.description}
          data={data}
          theme={theme}
          selected={current === opt.value}
          onSelect={() => onSelect(opt.value)}
        />
      ))}
    </div>
  );
}

export function TemplateGalleryPanel() {
  const { resumeData, theme, setTemplateId } = useResumeStore();
  return <TemplateGallery data={resumeData} theme={theme} onSelect={setTemplateId} />;
}
