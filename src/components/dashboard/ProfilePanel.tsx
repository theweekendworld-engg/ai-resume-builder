'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { upsertUserProfile, type UserProfileDTO } from '@/actions/profile';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { toast } from 'sonner';

interface ProfilePanelProps {
  profile?: UserProfileDTO;
}

export function ProfilePanel({ profile }: ProfilePanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const preferences = parseUserGenerationPreferences(profile?.preferences);

  const [form, setForm] = useState({
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    location: profile?.location ?? '',
    website: profile?.website ?? '',
    linkedin: profile?.linkedin ?? '',
    github: profile?.github ?? '',
    defaultTitle: profile?.defaultTitle ?? '',
    yearsExperience: profile?.yearsExperience ?? '',
    defaultSummary: profile?.defaultSummary ?? '',
    preferences: {
      defaultTemplate: preferences.defaultTemplate,
      defaultSectionOrder: preferences.defaultSectionOrder.join(','),
      maxProjects: String(preferences.maxProjects),
      includeOSS: preferences.includeOSS,
      tonePreference: preferences.tonePreference,
      autoGenerate: preferences.autoGenerate,
    },
  });

  const onSave = () => {
    startTransition(async () => {
      const result = await upsertUserProfile(form);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to save profile');
        return;
      }
      toast.success('Profile saved');
      router.refresh();
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">Canonical profile used for future resume generation.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} />
        <Input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
        <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
        <Input placeholder="Location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
        <Input placeholder="Website" value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} />
        <Input placeholder="LinkedIn" value={form.linkedin} onChange={(e) => setForm((p) => ({ ...p, linkedin: e.target.value }))} />
        <Input placeholder="GitHub" value={form.github} onChange={(e) => setForm((p) => ({ ...p, github: e.target.value }))} />
        <Input placeholder="Default title" value={form.defaultTitle} onChange={(e) => setForm((p) => ({ ...p, defaultTitle: e.target.value }))} />
        <Input
          placeholder="Years of experience"
          value={form.yearsExperience}
          onChange={(e) => setForm((p) => ({ ...p, yearsExperience: e.target.value }))}
        />
      </div>

      <div className="mt-3">
        <Textarea
          placeholder="Default summary"
          value={form.defaultSummary}
          onChange={(e) => setForm((p) => ({ ...p, defaultSummary: e.target.value }))}
          rows={4}
        />
      </div>

      <div className="mt-5 space-y-3 rounded-lg border border-border/70 p-4">
        <p className="text-sm font-medium">Generation Preferences</p>
        <p className="text-xs text-muted-foreground">Used by smart generation, clarification behavior, and ATS optimization.</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Default template</Label>
            <Select
              value={form.preferences.defaultTemplate}
              onValueChange={(value) => setForm((p) => ({
                ...p,
                preferences: {
                  ...p.preferences,
                  defaultTemplate: value as 'ats-simple' | 'modern' | 'classic',
                },
              }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ats-simple">ATS Simple</SelectItem>
                <SelectItem value="modern">Modern</SelectItem>
                <SelectItem value="classic">Classic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tone preference</Label>
            <Select
              value={form.preferences.tonePreference}
              onValueChange={(value) => setForm((p) => ({
                ...p,
                preferences: {
                  ...p.preferences,
                  tonePreference: value as 'formal' | 'conversational' | 'technical',
                },
              }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="technical">Technical</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="conversational">Conversational</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Input
            type="number"
            min={1}
            max={6}
            placeholder="Max projects (1-6)"
            value={form.preferences.maxProjects}
            onChange={(e) => setForm((p) => ({
              ...p,
              preferences: { ...p.preferences, maxProjects: e.target.value },
            }))}
          />
          <Input
            placeholder="Section order (comma separated)"
            value={form.preferences.defaultSectionOrder}
            onChange={(e) => setForm((p) => ({
              ...p,
              preferences: { ...p.preferences, defaultSectionOrder: e.target.value },
            }))}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-md border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Include OSS</p>
              <p className="text-xs text-muted-foreground">Use OSS contributions during matching.</p>
            </div>
            <Switch
              checked={form.preferences.includeOSS}
              onCheckedChange={(checked) => setForm((p) => ({
                ...p,
                preferences: { ...p.preferences, includeOSS: checked },
              }))}
            />
          </label>
          <label className="flex items-center justify-between rounded-md border border-border/60 p-3">
            <div>
              <p className="text-sm font-medium">Auto-generate</p>
              <p className="text-xs text-muted-foreground">Skip clarification questions when possible.</p>
            </div>
            <Switch
              checked={form.preferences.autoGenerate}
              onCheckedChange={(checked) => setForm((p) => ({
                ...p,
                preferences: { ...p.preferences, autoGenerate: checked },
              }))}
            />
          </label>
        </div>
      </div>

      <div className="mt-4">
        <Button onClick={onSave} disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </section>
  );
}
