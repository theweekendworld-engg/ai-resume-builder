import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OnboardingState } from '@/components/onboarding/types';

interface StepBackgroundProps {
  state: OnboardingState;
  update: (patch: Partial<OnboardingState>) => void;
}

export function StepBackground({ state, update }: StepBackgroundProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Your background</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" value={state.fullName} onChange={(e) => update({ fullName: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={state.email} onChange={(e) => update({ email: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={state.phone} onChange={(e) => update({ phone: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="linkedin">LinkedIn</Label>
          <Input id="linkedin" value={state.linkedin} onChange={(e) => update({ linkedin: e.target.value })} placeholder="linkedin.com/in/you" />
        </div>
      </div>
    </div>
  );
}
