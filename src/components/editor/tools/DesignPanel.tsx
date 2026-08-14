'use client';

import { Palette, Type, AlignVerticalSpaceAround, LayoutTemplate } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResumeStore } from '@/store/resumeStore';
import { ResumeFontFamily, ResumeDensity } from '@/types/resume';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { TemplateGalleryPanel } from '@/components/editor/tools/TemplateGalleryPanel';
import { SectionOrderEditor } from '@/components/editor/SectionOrderEditor';

// Curated, professional accent palette.
const ACCENT_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Navy', hex: '#1F4E79' },
  { name: 'Royal', hex: '#2563EB' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Emerald', hex: '#047857' },
  { name: 'Plum', hex: '#7C3AED' },
  { name: 'Crimson', hex: '#BE123C' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Charcoal', hex: '#111827' },
];

const FONT_OPTIONS: { value: ResumeFontFamily; label: string; sample: string; css: string }[] = [
  { value: 'sans', label: 'Sans', sample: 'Aa', css: 'ui-sans-serif, system-ui, sans-serif' },
  { value: 'serif', label: 'Serif', sample: 'Aa', css: 'Georgia, Cambria, serif' },
  { value: 'mono', label: 'Mono', sample: 'Aa', css: 'ui-monospace, Menlo, monospace' },
];

const DENSITY_OPTIONS: { value: ResumeDensity; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
];

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export function DesignPanel() {
  const { theme, updateTheme } = useResumeStore();

  const setAccent = (hex: string) => {
    const normalized = hex.startsWith('#') ? hex : `#${hex}`;
    updateTheme({ accentColor: normalized });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto pb-6">
      {/* Template gallery */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <LayoutTemplate className="h-4 w-4" /> Template
          </CardTitle>
          <CardDescription>Pick a look. The preview uses your own content, not placeholder text.</CardDescription>
        </CardHeader>
        <CardContent>
          <TemplateGalleryPanel />
        </CardContent>
      </Card>

      {/* Design controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Palette className="h-4 w-4" /> Design
          </CardTitle>
          <CardDescription>Accent, typography, and spacing. All templates stay ATS-parseable.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Accent color */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Accent color</Label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  title={s.name}
                  aria-label={s.name}
                  onClick={() => setAccent(s.hex)}
                  className={cn(
                    'h-7 w-7 rounded-full border transition-transform hover:scale-110',
                    theme.accentColor.toLowerCase() === s.hex.toLowerCase()
                      ? 'ring-2 ring-offset-2 ring-offset-background'
                      : 'border-border'
                  )}
                  style={{ backgroundColor: s.hex, ...(theme.accentColor.toLowerCase() === s.hex.toLowerCase() ? { boxShadow: `0 0 0 2px ${s.hex}` } : {}) }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="color"
                aria-label="Custom accent color"
                value={HEX_RE.test(theme.accentColor) ? (theme.accentColor.startsWith('#') ? theme.accentColor : `#${theme.accentColor}`) : '#1F4E79'}
                onChange={(e) => setAccent(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
              />
              <Input
                value={theme.accentColor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (HEX_RE.test(v) || v === '' || /^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                    setAccent(v);
                  }
                }}
                placeholder="#1F4E79"
                className="h-8 w-28 font-mono text-xs"
              />
            </div>
          </div>

          <Separator />

          {/* Font family */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Type className="h-3.5 w-3.5" /> Font family
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => updateTheme({ fontFamily: f.value })}
                  className={cn(
                    'flex flex-col items-center rounded-md border py-2 transition-colors',
                    theme.fontFamily === f.value ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/60'
                  )}
                >
                  <span style={{ fontFamily: f.css }} className="text-lg leading-none">{f.sample}</span>
                  <span className="mt-1 text-xs text-muted-foreground">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Density */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <AlignVerticalSpaceAround className="h-3.5 w-3.5" /> Density
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {DENSITY_OPTIONS.map((dn) => (
                <button
                  key={dn.value}
                  type="button"
                  onClick={() => updateTheme({ density: dn.value })}
                  className={cn(
                    'rounded-md border py-2 text-sm transition-colors',
                    theme.density === dn.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-secondary/60'
                  )}
                >
                  {dn.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section order (reuse the existing editor) */}
      <SectionOrderEditor />
    </div>
  );
}
