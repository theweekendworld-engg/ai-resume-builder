'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { upsertUserProfile, completeOnboarding } from '@/actions/profile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { UserProfileDTO } from '@/actions/profile';

type OnboardingDialogProps = {
  profile: UserProfileDTO | undefined;
  onComplete: () => void;
};

const STEP_BASICS = 0;
const STEP_BACKGROUND = 1;

export function OnboardingDialog({ profile, onComplete }: OnboardingDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState(STEP_BASICS);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    fullName: profile?.fullName ?? '',
    email: profile?.email ?? '',
    phone: profile?.phone ?? '',
    defaultTitle: profile?.defaultTitle ?? '',
    yearsExperience: profile?.yearsExperience ?? '',
    linkedin: profile?.linkedin ?? '',
    github: profile?.github ?? '',
    defaultSummary: profile?.defaultSummary ?? '',
  });

  const open = true;

  const handleNext = () => {
    if (step === STEP_BASICS) {
      setStep(STEP_BACKGROUND);
      return;
    }

    startTransition(async () => {
      const result = await upsertUserProfile({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        defaultTitle: form.defaultTitle,
        yearsExperience: form.yearsExperience,
        linkedin: form.linkedin,
        github: form.github,
        defaultSummary: form.defaultSummary,
      });

      if (!result.success) {
        toast.error(result.error ?? 'Failed to save');
        return;
      }

      const done = await completeOnboarding();
      if (!done.success) {
        toast.error(done.error ?? 'Failed to complete onboarding');
        return;
      }

      toast.success("You're all set!");
      onComplete();
      router.refresh();
    });
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{step === STEP_BASICS ? 'Welcome' : 'Professional background'}</DialogTitle>
          <DialogDescription>
            {step === STEP_BASICS
              ? 'Tell us a few basics so we can personalize your experience.'
              : 'Optional: add experience and links so we can tailor your resumes.'}
          </DialogDescription>
        </DialogHeader>

        {step === STEP_BASICS && (
          <div className="grid gap-3 py-2">
            <Input
              placeholder="Full name"
              value={form.fullName}
              onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
            <Input
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            />
            <Input
              placeholder="Current role / title"
              value={form.defaultTitle}
              onChange={(e) => setForm((p) => ({ ...p, defaultTitle: e.target.value }))}
            />
          </div>
        )}

        {step === STEP_BACKGROUND && (
          <div className="grid gap-3 py-2">
            <Input
              placeholder="Years of experience"
              value={form.yearsExperience}
              onChange={(e) => setForm((p) => ({ ...p, yearsExperience: e.target.value }))}
            />
            <Input
              placeholder="LinkedIn URL"
              value={form.linkedin}
              onChange={(e) => setForm((p) => ({ ...p, linkedin: e.target.value }))}
            />
            <Input
              placeholder="GitHub handle or URL"
              value={form.github}
              onChange={(e) => setForm((p) => ({ ...p, github: e.target.value }))}
            />
            <Textarea
              placeholder="Brief professional summary"
              value={form.defaultSummary}
              onChange={(e) => setForm((p) => ({ ...p, defaultSummary: e.target.value }))}
              rows={3}
            />
          </div>
        )}

        <DialogFooter>
          {step > STEP_BASICS && (
            <Button variant="outline" onClick={() => setStep(STEP_BASICS)} disabled={isPending}>
              Back
            </Button>
          )}
          <Button onClick={handleNext} disabled={isPending}>
            {isPending ? 'Saving…' : step === STEP_BACKGROUND ? 'Finish' : 'Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
