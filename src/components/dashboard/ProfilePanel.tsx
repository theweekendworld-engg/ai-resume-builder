'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { upsertUserProfile, type UserProfileDTO } from '@/actions/profile';
import { toast } from 'sonner';

interface ProfilePanelProps {
  profile?: UserProfileDTO;
}

export function ProfilePanel({ profile }: ProfilePanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

      <div className="mt-4">
        <Button onClick={onSave} disabled={isPending}>
          {isPending ? 'Saving...' : 'Save Profile'}
        </Button>
      </div>
    </section>
  );
}
