import { OnboardingState } from '@/components/onboarding/types';
import { TEMPLATE_OPTIONS, LatexTemplateType } from '@/templates/latex';

interface StepTemplateProps {
  state: OnboardingState;
  update: (patch: Partial<OnboardingState>) => void;
}

export function StepTemplate({ state, update }: StepTemplateProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Pick a template</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {TEMPLATE_OPTIONS.map((template) => (
          <button
            key={template.value}
            type="button"
            className={`rounded-lg border p-4 text-left transition-colors ${
              state.template === template.value
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => update({ template: template.value as LatexTemplateType })}
          >
            <p className="font-medium">{template.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
