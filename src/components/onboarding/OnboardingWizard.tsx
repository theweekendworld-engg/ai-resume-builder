'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { generateInitialResume } from '@/actions/generate';
import { getUserProfile } from '@/actions/profile';
import { Button } from '@/components/ui/button';
import { StepBackground } from '@/components/onboarding/StepBackground';
import { StepTemplate } from '@/components/onboarding/StepTemplate';
import { StepGenerate } from '@/components/onboarding/StepGenerate';
import { OnboardingState } from '@/components/onboarding/types';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';

const steps = ['Background', 'Template', 'Generate'] as const;

const initialState: OnboardingState = {
  fullName: '',
  email: '',
  phone: '',
  linkedin: '',
  template: 'ats-simple',
};

export function OnboardingWizard() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initialState);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await getUserProfile();
      if (!result.success || !result.profile || cancelled) return;

      const preferences = parseUserGenerationPreferences(result.profile.preferences);
      setState((prev) => ({
        ...prev,
        fullName: prev.fullName || result.profile?.fullName || '',
        email: prev.email || result.profile?.email || '',
        phone: prev.phone || result.profile?.phone || '',
        linkedin: prev.linkedin || result.profile?.linkedin || '',
        template: prev.template === initialState.template ? preferences.defaultTemplate : prev.template,
      }));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isLastDataStep = step === 1;

  const stepContent = useMemo(() => {
    if (step === 0) return <StepBackground state={state} update={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
    if (step === 1) return <StepTemplate state={state} update={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
    return <StepGenerate />;
  }, [state, step]);

  const handleNext = () => {
    if (!isLastDataStep) {
      setStep((prev) => Math.min(prev + 1, 2));
      return;
    }

    setStep(2);
    setError(null);

    startTransition(async () => {
      const result = await generateInitialResume({
        fullName: state.fullName,
        email: state.email,
        phone: state.phone,
        linkedin: state.linkedin,
        template: state.template,
      });

      if (!result.success || !result.resumeId) {
        setError(result.error ?? 'Failed to generate your resume. Please retry.');
        setStep(1);
        return;
      }

      router.push(`/editor/${result.resumeId}?template=${result.template ?? state.template}`);
    });
  };

  const handleBack = () => {
    if (step === 0 || isPending || step === 2) return;
    setStep((prev) => Math.max(prev - 1, 0));
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Step {Math.min(step + 1, 3)} of 3</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create your first resume</h1>
        <p className="mt-2 text-sm text-muted-foreground">{steps[step]}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        {stepContent}

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            <p>{error}</p>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <Button variant="outline" onClick={handleBack} disabled={step === 0 || step === 2 || isPending}>
            Back
          </Button>

          {step < 2 && (
            <Button onClick={handleNext} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : isLastDataStep ? (
                'Generate Resume'
              ) : (
                'Continue'
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
