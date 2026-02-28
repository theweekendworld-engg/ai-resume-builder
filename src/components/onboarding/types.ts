import { LatexTemplateType } from '@/templates/latex';

export interface OnboardingState {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  template: LatexTemplateType;
}
