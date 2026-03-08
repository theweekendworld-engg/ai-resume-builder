'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
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
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { ImportPreviewDialog } from '@/components/resume-import/ImportPreviewDialog';
import type { ParsedResumeData } from '@/lib/aiSchemas';

type OnboardingDialogProps = {
  profile: UserProfileDTO | undefined;
  onComplete: () => void;
};

const STEP_UPLOAD = 0;
const STEP_BASICS = 1;
const STEP_BACKGROUND = 2;

export function OnboardingDialog({ profile, onComplete }: OnboardingDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState(STEP_UPLOAD);
  const [parsedData, setParsedData] = useState<ParsedResumeData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
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
  const [saveState, submitProfile, isPending] = useActionState(
    async (
      _previous: { success: boolean; error?: string },
      payload: typeof form
    ) => {
      const result = await upsertUserProfile({
        fullName: payload.fullName,
        email: payload.email,
        phone: payload.phone,
        defaultTitle: payload.defaultTitle,
        yearsExperience: payload.yearsExperience,
        linkedin: payload.linkedin,
        github: payload.github,
        defaultSummary: payload.defaultSummary,
      });

      if (!result.success) {
        return { success: false, error: result.error ?? 'Failed to save profile' };
      }

      const done = await completeOnboarding();
      if (!done.success) {
        return { success: false, error: done.error ?? 'Failed to complete onboarding' };
      }

      return { success: true };
    },
    { success: false }
  );
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!saveState.success) {
      if (saveState.error) toast.error(saveState.error);
      return;
    }
    toast.success("You're all set!");
    onComplete();
    router.refresh();
  }, [onComplete, router, saveState.error, saveState.success]);

  const handleParsed = (data: ParsedResumeData) => {
    setParsedData(data);
    setShowPreview(true);
  };

  const handleImportDone = () => {
    if (parsedData) {
      const pi = parsedData.personalInfo;
      setForm((prev) => ({
        ...prev,
        fullName: pi.fullName || prev.fullName,
        email: pi.email || prev.email,
        phone: pi.phone || prev.phone,
        defaultTitle: pi.title || prev.defaultTitle,
        linkedin: pi.linkedin || prev.linkedin,
        github: pi.github || prev.github,
        defaultSummary: pi.summary || prev.defaultSummary,
      }));
    }
    setShowPreview(false);
    setStep(STEP_BASICS);
  };

  const handleClose = () => {
    if (isClosing || isPending) return;
    setIsClosing(true);
    onComplete();

    startTransition(async () => {
      const done = await completeOnboarding();
      if (!done.success) {
        toast.error(done.error ?? 'Failed to complete onboarding');
      }
      router.refresh();
      setIsClosing(false);
    });
  };

  const handleNext = () => {
    if (step === STEP_UPLOAD) {
      setStep(STEP_BASICS);
      return;
    }
    if (step === STEP_BASICS) {
      setStep(STEP_BACKGROUND);
      return;
    }

    startTransition(() => {
      submitProfile(form);
    });
  };

  const stepTitles = ['Got an existing resume?', 'Welcome', 'Professional background'];
  const stepDescriptions = [
    'Upload your PDF resume to pre-fill your profile automatically.',
    'Tell us a few basics so we can personalize your experience.',
    'Optional: add experience and links so we can tailor your resumes.',
  ];

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{stepTitles[step]}</DialogTitle>
            <DialogDescription>{stepDescriptions[step]}</DialogDescription>
          </DialogHeader>

          {step === STEP_UPLOAD && (
            <ResumeUploadZone
              onParsed={handleParsed}
              onSkip={() => setStep(STEP_BASICS)}
              compact
            />
          )}

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
            {step > STEP_UPLOAD && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={isPending}>
                Back
              </Button>
            )}
            {step !== STEP_UPLOAD && (
              <Button onClick={handleNext} disabled={isPending}>
                {isPending ? 'Saving…' : step === STEP_BACKGROUND ? 'Finish' : 'Continue'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {parsedData && (
        <ImportPreviewDialog
          data={parsedData}
          open={showPreview}
          onClose={() => { setShowPreview(false); setStep(STEP_BASICS); }}
          onImported={handleImportDone}
        />
      )}
    </>
  );
}
