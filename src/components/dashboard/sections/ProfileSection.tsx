'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createUserExperience,
  deleteUserExperience,
  listUserExperiences,
} from '@/actions/experiences';
import {
  createUserEducation,
  deleteUserEducation,
  listUserEducation,
} from '@/actions/education';
import { upsertUserProfile, updateUserPreferences, type UserProfileDTO } from '@/actions/profile';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProjectLibraryPanel } from '@/components/dashboard/ProjectLibraryPanel';
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { ImportPreviewDialog } from '@/components/resume-import/ImportPreviewDialog';
import type { ParsedResumeData } from '@/lib/aiSchemas';
import { toast } from 'sonner';

type ProjectItem = {
  id: string;
  name: string;
  description: string;
  url: string;
  githubUrl: string | null;
  technologies: string[];
  source: 'github' | 'manual';
  embedded: boolean;
  updatedAt: Date;
};

type ProfileSectionProps = {
  profile: UserProfileDTO | undefined;
  projects: ProjectItem[];
};

export function ProfileSection({ profile, projects }: ProfileSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const prefs = parseUserGenerationPreferences(profile?.preferences);

  const [personal, setPersonal] = useState({
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
  });

  const [preferences, setPreferences] = useState({
    defaultTemplate: prefs.defaultTemplate,
    defaultSectionOrder: prefs.defaultSectionOrder.join(', '),
    maxProjects: String(prefs.maxProjects),
    includeOSS: prefs.includeOSS,
    tonePreference: prefs.tonePreference,
    autoGenerate: prefs.autoGenerate,
  });

  const [experiences, setExperiences] = useState<Array<{
    id: string;
    company: string;
    role: string;
    startDate: string;
    endDate: string;
    current: boolean;
    location: string;
    description: string;
    highlights: string[];
  }>>([]);
  const [education, setEducation] = useState<Array<{
    id: string;
    institution: string;
    degree: string;
    fieldOfStudy: string;
    startDate: string;
    endDate: string;
    current: boolean;
  }>>([]);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setTimeout(() => {
      setPersonal({
        fullName: profile.fullName ?? '',
        email: profile.email ?? '',
        phone: profile.phone ?? '',
        location: profile.location ?? '',
        website: profile.website ?? '',
        linkedin: profile.linkedin ?? '',
        github: profile.github ?? '',
        defaultTitle: profile.defaultTitle ?? '',
        yearsExperience: profile.yearsExperience ?? '',
        defaultSummary: profile.defaultSummary ?? '',
      });
      const p = parseUserGenerationPreferences(profile.preferences);
      setPreferences({
        defaultTemplate: p.defaultTemplate,
        defaultSectionOrder: p.defaultSectionOrder.join(', '),
        maxProjects: String(p.maxProjects),
        includeOSS: p.includeOSS,
        tonePreference: p.tonePreference,
        autoGenerate: p.autoGenerate,
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [profile]);

  useEffect(() => {
    listUserExperiences().then((r) => {
      if (r.success && r.experiences) {
        setExperiences(r.experiences.map((e) => ({
          id: e.id,
          company: e.company,
          role: e.role,
          startDate: e.startDate,
          endDate: e.endDate,
          current: e.current,
          location: e.location,
          description: e.description,
          highlights: Array.isArray(e.highlights) ? e.highlights : [],
        })));
      }
    });
  }, []);

  useEffect(() => {
    listUserEducation().then((r) => {
      if (r.success && r.education) setEducation(r.education);
    });
  }, []);

  const savePersonal = () => {
    startTransition(async () => {
      const result = await upsertUserProfile(personal);
      if (!result.success) {
        toast.error(result.error ?? 'Failed to save');
        return;
      }
      toast.success('Profile saved');
      router.refresh();
    });
  };

  const savePreferences = () => {
    startTransition(async () => {
      const result = await updateUserPreferences({
        defaultTemplate: preferences.defaultTemplate,
        defaultSectionOrder: preferences.defaultSectionOrder.split(/[\s,]+/).filter(Boolean),
        maxProjects: Number(preferences.maxProjects) || 3,
        includeOSS: preferences.includeOSS,
        tonePreference: preferences.tonePreference,
        autoGenerate: preferences.autoGenerate,
      });
      if (!result.success) {
        toast.error(result.error ?? 'Failed to save preferences');
        return;
      }
      toast.success('Preferences saved');
      router.refresh();
    });
  };

  const refreshExperiences = () => {
    listUserExperiences().then((r) => {
      if (r.success && r.experiences) {
        setExperiences(r.experiences.map((e) => ({
          id: e.id,
          company: e.company,
          role: e.role,
          startDate: e.startDate,
          endDate: e.endDate,
          current: e.current,
          location: e.location,
          description: e.description,
          highlights: Array.isArray(e.highlights) ? e.highlights : [],
        })));
      }
    });
  };

  const refreshEducation = () => {
    listUserEducation().then((r) => {
      if (r.success && r.education) setEducation(r.education);
    });
  };

  const [parsedData, setParsedData] = useState<ParsedResumeData | null>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);

  const handleParsed = (data: ParsedResumeData) => {
    setParsedData(data);
    setShowImportPreview(true);
  };

  const projectItems: ProjectItem[] = projects.map((p) => ({
    ...p,
    source: p.source as 'github' | 'manual',
    embedded: p.embedded ?? false,
    technologies: (Array.isArray(p.technologies) ? p.technologies : []) as string[],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile Settings</h1>
        <p className="text-muted-foreground">Personal info, experience, education, projects, and preferences.</p>
      </div>

      <Tabs defaultValue="personal">
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="import">Import Resume</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="personal" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Personal info</CardTitle>
              <CardDescription>Used for resume generation and contact.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Full name" value={personal.fullName} onChange={(e) => setPersonal((p) => ({ ...p, fullName: e.target.value }))} />
              <Input placeholder="Email" value={personal.email} onChange={(e) => setPersonal((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder="Phone" value={personal.phone} onChange={(e) => setPersonal((p) => ({ ...p, phone: e.target.value }))} />
              <Input placeholder="Location" value={personal.location} onChange={(e) => setPersonal((p) => ({ ...p, location: e.target.value }))} />
              <Input placeholder="Website" value={personal.website} onChange={(e) => setPersonal((p) => ({ ...p, website: e.target.value }))} />
              <Input placeholder="LinkedIn" value={personal.linkedin} onChange={(e) => setPersonal((p) => ({ ...p, linkedin: e.target.value }))} />
              <Input placeholder="GitHub" value={personal.github} onChange={(e) => setPersonal((p) => ({ ...p, github: e.target.value }))} />
              <Input placeholder="Default title" value={personal.defaultTitle} onChange={(e) => setPersonal((p) => ({ ...p, defaultTitle: e.target.value }))} />
              <Input placeholder="Years of experience" value={personal.yearsExperience} onChange={(e) => setPersonal((p) => ({ ...p, yearsExperience: e.target.value }))} />
              <div className="sm:col-span-2">
                <Textarea placeholder="Default summary" value={personal.defaultSummary} onChange={(e) => setPersonal((p) => ({ ...p, defaultSummary: e.target.value }))} rows={4} />
              </div>
              <Button onClick={savePersonal} disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="experience" className="mt-4">
          <ExperienceTab experiences={experiences} onRefresh={refreshExperiences} />
        </TabsContent>

        <TabsContent value="education" className="mt-4">
          <EducationTab education={education} onRefresh={refreshEducation} />
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <ProjectLibraryPanel projects={projectItems} />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Import from resume</CardTitle>
              <CardDescription>
                Upload your existing PDF resume to automatically populate your profile, experience,
                education, projects, and achievements.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResumeUploadZone onParsed={handleParsed} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Generation preferences</CardTitle>
              <CardDescription>Defaults for smart generation and ATS.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Default template</Label>
                  <Select value={preferences.defaultTemplate} onValueChange={(v) => setPreferences((p) => ({ ...p, defaultTemplate: v as 'ats-simple' | 'modern' | 'classic' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ats-simple">ATS Simple</SelectItem>
                      <SelectItem value="modern">Modern</SelectItem>
                      <SelectItem value="classic">Classic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tone</Label>
                  <Select value={preferences.tonePreference} onValueChange={(v) => setPreferences((p) => ({ ...p, tonePreference: v as 'formal' | 'conversational' | 'technical' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="formal">Formal</SelectItem>
                      <SelectItem value="conversational">Conversational</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Max projects (1–6)</Label>
                  <Input type="number" min={1} max={6} value={preferences.maxProjects} onChange={(e) => setPreferences((p) => ({ ...p, maxProjects: e.target.value }))} />
                </div>
                <div>
                  <Label>Section order (comma separated)</Label>
                  <Input placeholder="summary, experience, projects, education, skills" value={preferences.defaultSectionOrder} onChange={(e) => setPreferences((p) => ({ ...p, defaultSectionOrder: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">Include OSS</p>
                  <p className="text-xs text-muted-foreground">Use OSS contributions when matching.</p>
                </div>
                <Switch checked={preferences.includeOSS} onCheckedChange={(c) => setPreferences((p) => ({ ...p, includeOSS: c }))} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">Auto-generate</p>
                  <p className="text-xs text-muted-foreground">Skip clarification when possible.</p>
                </div>
                <Switch checked={preferences.autoGenerate} onCheckedChange={(c) => setPreferences((p) => ({ ...p, autoGenerate: c }))} />
              </div>
              <Button onClick={savePreferences} disabled={isPending}>{isPending ? 'Saving…' : 'Save preferences'}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {parsedData && (
        <ImportPreviewDialog
          data={parsedData}
          open={showImportPreview}
          onClose={() => setShowImportPreview(false)}
          onImported={() => {
            setShowImportPreview(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ExperienceTab({
  experiences,
  onRefresh,
}: {
  experiences: Array<{ id: string; company: string; role: string; startDate: string; endDate: string; current: boolean; location: string; description: string; highlights: string[] }>;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({ company: '', role: '', startDate: '', endDate: '', current: false, location: '', description: '' });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const add = () => {
    startTransition(async () => {
      const r = await createUserExperience(form);
      if (!r.success) {
        toast.error(r.error ?? 'Failed to add');
        return;
      }
      toast.success('Experience added');
      setForm({ company: '', role: '', startDate: '', endDate: '', current: false, location: '', description: '' });
      onRefresh();
      router.refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const r = await deleteUserExperience(id);
      if (!r.success) {
        toast.error(r.error ?? 'Failed to delete');
        return;
      }
      toast.success('Removed');
      onRefresh();
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Work experience</CardTitle>
        <CardDescription>Reusable experience entries for generation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Company" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} />
          <Input placeholder="Role" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} />
          <Input placeholder="Start date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
          <Input placeholder="End date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
          <Input placeholder="Location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.current} onChange={(e) => setForm((p) => ({ ...p, current: e.target.checked }))} />
            <Label>Current</Label>
          </div>
          <div className="sm:col-span-2">
            <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} />
          </div>
          <Button onClick={add} disabled={pending || !form.company || !form.role || !form.startDate}>Add experience</Button>
        </div>
        <ul className="space-y-3">
          {experiences.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">{e.role} at {e.company}</p>
                <p className="text-xs text-muted-foreground">{e.startDate} – {e.current ? 'Present' : e.endDate}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => remove(e.id)} disabled={pending}>Delete</Button>
            </li>
          ))}
        </ul>
        {experiences.length === 0 && (
          <p className="text-sm text-muted-foreground">No experience entries yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function EducationTab({
  education,
  onRefresh,
}: {
  education: Array<{ id: string; institution: string; degree: string; fieldOfStudy: string; startDate: string; endDate: string; current: boolean }>;
  onRefresh: () => void;
}) {
  const [form, setForm] = useState({ institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', current: false });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const add = () => {
    startTransition(async () => {
      const r = await createUserEducation(form);
      if (!r.success) {
        toast.error(r.error ?? 'Failed to add');
        return;
      }
      toast.success('Education added');
      setForm({ institution: '', degree: '', fieldOfStudy: '', startDate: '', endDate: '', current: false });
      onRefresh();
      router.refresh();
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const r = await deleteUserEducation(id);
      if (!r.success) {
        toast.error(r.error ?? 'Failed to delete');
        return;
      }
      toast.success('Removed');
      onRefresh();
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Education</CardTitle>
        <CardDescription>Reusable education entries for generation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Institution" value={form.institution} onChange={(e) => setForm((p) => ({ ...p, institution: e.target.value }))} />
          <Input placeholder="Degree" value={form.degree} onChange={(e) => setForm((p) => ({ ...p, degree: e.target.value }))} />
          <Input placeholder="Field of study" value={form.fieldOfStudy} onChange={(e) => setForm((p) => ({ ...p, fieldOfStudy: e.target.value }))} />
          <Input placeholder="Start date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
          <Input placeholder="End date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={form.current} onChange={(e) => setForm((p) => ({ ...p, current: e.target.checked }))} />
            <Label>Current</Label>
          </div>
          <Button onClick={add} disabled={pending || !form.institution || !form.degree || !form.startDate}>Add education</Button>
        </div>
        <ul className="space-y-3">
          {education.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="font-medium">{e.degree} – {e.institution}</p>
                <p className="text-xs text-muted-foreground">{e.startDate} – {e.current ? 'Present' : e.endDate}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => remove(e.id)} disabled={pending}>Delete</Button>
            </li>
          ))}
        </ul>
        {education.length === 0 && (
          <p className="text-sm text-muted-foreground">No education entries yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
