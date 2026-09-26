import { parseJobDescription } from '@/actions/generateResume';
import type {
  ExtensionAnalyzePageRequest,
  ExtensionAnalyzePageResponse,
  ExtensionProfileBundle,
} from '@/lib/extension/schemas';
import { computeFitScore, findMatchedSkills, normalizeText, uniqueStrings } from '@/lib/extension/fitScore';

// Re-exported: this was the published home, and callers outside the step
// bundles may still import it from here.
export { computeFitScore, findMatchedSkills };

function buildBundleCorpus(bundle: ExtensionProfileBundle): string {
  return normalizeText([
    bundle.profile.fullName,
    bundle.profile.defaultTitle,
    bundle.profile.defaultSummary,
    bundle.profile.location,
    bundle.profile.linkedin,
    bundle.profile.github,
    bundle.experiences.map((item) => [
      item.company,
      item.role,
      item.description,
      ...item.highlights,
    ].join(' ')).join(' '),
    bundle.education.map((item) => [
      item.institution,
      item.degree,
      item.fieldOfStudy,
    ].join(' ')).join(' '),
    bundle.projects.map((item) => [
      item.name,
      item.description,
      item.url,
      item.githubUrl ?? '',
      ...item.technologies,
    ].join(' ')).join(' '),
  ].join(' '));
}

function scoreProject(project: ExtensionProfileBundle['projects'][number], requiredSkills: string[], preferredSkills: string[]) {
  const projectText = normalizeText([
    project.name,
    project.description,
    project.url,
    project.githubUrl ?? '',
    ...project.technologies,
  ].join(' '));

  const requiredMatches = findMatchedSkills(requiredSkills, projectText);
  const preferredMatches = findMatchedSkills(preferredSkills, projectText);
  const score = (requiredMatches.length * 3) + (preferredMatches.length * 2);

  return {
    id: project.id,
    name: project.name,
    score,
    matchReason: uniqueStrings([...requiredMatches, ...preferredMatches]).slice(0, 3).join(', '),
  };
}

export async function analyzeExtensionJobPage(params: {
  userId: string;
  input: ExtensionAnalyzePageRequest;
  bundle: ExtensionProfileBundle;
}): Promise<ExtensionAnalyzePageResponse> {
  const metadata = params.input.metadata ?? params.input.normalizedPage?.metadata;
  const extractedJobDescription = params.input.extractedJobDescription ?? params.input.normalizedPage?.jobDescription;
  const jobDescriptionText = params.input.jobDescription ?? extractedJobDescription?.text ?? '';

  const parsedJD = await parseJobDescription({
    userId: params.userId,
    jobDescription: jobDescriptionText,
  });

  const corpus = buildBundleCorpus(params.bundle);
  const requiredSkills = uniqueStrings(parsedJD.requiredSkills);
  const preferredSkills = uniqueStrings(parsedJD.preferredSkills);

  const { fitScore, matchedRequired, matchedPreferred, missingRequired } = computeFitScore({
    requiredSkills,
    preferredSkills,
    corpus,
  });

  const suggestedProjects = params.bundle.projects
    .map((project) => scoreProject(project, requiredSkills, preferredSkills))
    .filter((project) => project.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const strengths = uniqueStrings([
    matchedRequired.length > 0 ? `Matched ${matchedRequired.length} required skills from the job description.` : '',
    matchedPreferred.length > 0 ? `Matched ${matchedPreferred.length} preferred skills that strengthen this application.` : '',
    params.bundle.experiences.length > 0 ? `Profile includes ${params.bundle.experiences.length} experience entries to support tailored answers.` : '',
    suggestedProjects.length > 0 ? `Found ${suggestedProjects.length} relevant projects that can strengthen a developer-focused application.` : '',
  ]).slice(0, 4);

  const gaps = uniqueStrings([
    ...missingRequired.slice(0, 5).map((skill) => `Missing explicit evidence for ${skill}.`),
    matchedRequired.length === 0 && requiredSkills.length > 0
      ? 'Current profile does not strongly mirror the core required skills yet.'
      : '',
  ]).slice(0, 5);

  const recommendedNextAction =
    fitScore >= 75
      ? 'fill_basics'
      : fitScore >= 55
        ? 'tailor_resume'
        : 'review_before_applying';

  const summary = fitScore >= 75
    ? 'This looks like a strong match. Autofill basics first, then tailor the resume only if the form asks deeper questions.'
    : fitScore >= 55
      ? 'This is a plausible fit, but a tailored resume and stronger evidence for missing skills would improve the application.'
      : 'This looks like a stretch right now. Review the missing requirements before spending time on a full application.';

  return {
    success: true,
    metadata: {
      companyName: params.input.companyName || metadata?.companyName || parsedJD.company || undefined,
      roleTitle: params.input.roleTitle || metadata?.roleTitle || parsedJD.role || undefined,
      location: params.input.location || metadata?.location || undefined,
      employmentType: metadata?.employmentType,
      compensationText: metadata?.compensationText,
      workplaceType: metadata?.workplaceType || (parsedJD.isRemote ? 'remote' : 'unknown'),
    },
    parsedJD,
    fitScore,
    strengths,
    gaps,
    matchedSkills: uniqueStrings([...matchedRequired, ...matchedPreferred]),
    missingSkills: missingRequired.slice(0, 8),
    suggestedProjects,
    recommendedNextAction,
    summary,
  };
}
