'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { generateInitialResume } from '@/actions/generate';
import { getUserProfile } from '@/actions/profile';
import { importParsedResumeData } from '@/actions/resumeImport';
import { Button } from '@/components/ui/button';
import { StepBackground } from '@/components/onboarding/StepBackground';
import { StepTemplate } from '@/components/onboarding/StepTemplate';
import { StepGenerate } from '@/components/onboarding/StepGenerate';
import { OnboardingState } from '@/components/onboarding/types';
import { parseUserGenerationPreferences } from '@/lib/userPreferences';
import { ResumeUploadZone } from '@/components/resume-import/ResumeUploadZone';
import { ImportPreviewDialog } from '@/components/resume-import/ImportPreviewDialog';
import type { ParsedResumeData } from '@/lib/aiSchemas';

const steps = ['Import Resume', 'Background', 'Template', 'Generate'] as const;

const initialState: OnboardingState = {
  fullName: '',
  email: '',
  phone: '',
  linkedin: '',
  template: 'ats-simple',
};

// Steps: 0=Import, 1=Background, 2=Template, 3=Generate
const STEP_IMPORT = 0;
const STEP_BACKGROUND = 1;
const STEP_TEMPLATE = 2;
const STEP_GENERATE = 3;

export function OnboardingWizard() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initialState);
  const [step, setStep] = useState(STEP_IMPORT);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [parsedData, setParsedData] = useState<ParsedResumeData | null>(null);
  const [showPreview, setShowPreview] = useState(false);

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

  const isLastDataStep = step === STEP_TEMPLATE;

  const handleParsed = (data: ParsedResumeData) => {
    setParsedData(data);
    setShowPreview(true);
  };

  const handleImportDone = () => {
    if (parsedData) {
      const pi = parsedData.personalInfo;
      setState((prev) => ({
        ...prev,
        fullName: pi.fullName || prev.fullName,
        email: pi.email || prev.email,
        phone: pi.phone || prev.phone,
        linkedin: pi.linkedin || prev.linkedin,
        parsedResume: parsedData,
      }));
    }
    setShowPreview(false);
    setStep(STEP_BACKGROUND);
  };

  const stepContent = useMemo(() => {
    if (step === STEP_IMPORT) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Upload your existing PDF resume and we&apos;ll pre-fill your profile, experience,
            education, and projects automatically.
          </p>
          <ResumeUploadZone onParsed={handleParsed} onSkip={() => setStep(STEP_BACKGROUND)} />
        </div>
      );
    }
    if (step === STEP_BACKGROUND) return <StepBackground state={state} update={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
    if (step === STEP_TEMPLATE) return <StepTemplate state={state} update={(patch) => setState((prev) => ({ ...prev, ...patch }))} />;
    return <StepGenerate />;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, step]);

  const handleNext = () => {
    if (!isLastDataStep) {
      setStep((prev) => Math.min(prev + 1, STEP_GENERATE));
      return;
    }

    setStep(STEP_GENERATE);
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
        setStep(STEP_TEMPLATE);
        return;
      }

      if (state.parsedResume) {
        importParsedResumeData(state.parsedResume, {
          mergeProfile: false,
          sections: { experience: true, education: true, projects: true, achievements: true },
        }).catch(() => {});
      }

      router.push(`/editor/${result.resumeId}?template=${result.template ?? state.template}`);
    });
  };

  const handleBack = () => {
    if (step === STEP_IMPORT || isPending || step === STEP_GENERATE) return;
    setStep((prev) => Math.max(prev - 1, STEP_IMPORT));
  };

  const totalSteps = steps.length;

  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Step {Math.min(step + 1, totalSteps)} of {totalSteps}
          </p>
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
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={step === STEP_IMPORT || step === STEP_GENERATE || isPending}
            >
              Back
            </Button>

            {step < STEP_GENERATE && step > STEP_IMPORT && (
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

      {parsedData && (
        <ImportPreviewDialog
          data={parsedData}
          open={showPreview}
          onClose={() => { setShowPreview(false); setStep(STEP_BACKGROUND); }}
          onImported={handleImportDone}
        />
      )}
    </>
  );
}
