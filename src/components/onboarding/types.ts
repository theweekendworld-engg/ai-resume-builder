import { LatexTemplateType } from '@/templates/latex';
import type { ParsedResumeData } from '@/lib/aiSchemas';

export interface OnboardingState {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  template: LatexTemplateType;
  parsedResume?: ParsedResumeData;
}
