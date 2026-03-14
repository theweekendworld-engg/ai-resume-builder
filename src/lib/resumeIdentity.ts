import type { ResumeData } from '@/types/resume';

type ResumeTargetSource = {
  targetRole?: string | null;
  targetCompany?: string | null;
  fallbackTargetRole?: string | null;
  fallbackTargetCompany?: string | null;
  resumeRole?: string | null;
};

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function extractParsedJDTarget(value: unknown): { role: string | null; company: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { role: null, company: null };
  }

  const candidate = value as Record<string, unknown>;
  return {
    role: normalizeValue(typeof candidate.role === 'string' ? candidate.role : null),
    company: normalizeValue(typeof candidate.company === 'string' ? candidate.company : null),
  };
}

export function resolveResumeTarget(source: ResumeTargetSource): {
  targetRole: string | null;
  targetCompany: string | null;
} {
  return {
    targetRole: normalizeValue(source.targetRole)
      ?? normalizeValue(source.fallbackTargetRole)
      ?? normalizeValue(source.resumeRole)
      ?? null,
    targetCompany: normalizeValue(source.targetCompany)
      ?? normalizeValue(source.fallbackTargetCompany)
      ?? null,
  };
}

export function getFallbackResumeTitle(fullName: string | null | undefined, fallback = 'Generated Resume'): string {
  const normalizedName = normalizeValue(fullName);
  return normalizedName ? `${normalizedName} Resume` : fallback;
}

export function buildResumeTitle(source: {
  targetRole?: string | null;
  targetCompany?: string | null;
  fallbackTitle?: string | null;
}): string {
  const targetRole = normalizeValue(source.targetRole);
  const targetCompany = normalizeValue(source.targetCompany);

  if (targetCompany && targetRole) {
    return `${targetCompany} - ${targetRole}`;
  }
  if (targetCompany) {
    return `${targetCompany} Resume`;
  }
  if (targetRole) {
    return `${targetRole} Resume`;
  }

  return normalizeValue(source.fallbackTitle) ?? 'Generated Resume';
}

export function shouldPreferDerivedResumeTitle(source: {
  storedTitle?: string | null;
  targetRole?: string | null;
  targetCompany?: string | null;
}): boolean {
  const storedTitle = normalizeValue(source.storedTitle);
  const targetRole = normalizeValue(source.targetRole);
  const targetCompany = normalizeValue(source.targetCompany);

  if (!storedTitle) return true;
  if (!targetRole && !targetCompany) return false;

  const lowerTitle = storedTitle.toLowerCase();
  const mentionsRole = targetRole ? lowerTitle.includes(targetRole.toLowerCase()) : false;
  const mentionsCompany = targetCompany ? lowerTitle.includes(targetCompany.toLowerCase()) : false;

  if (mentionsRole || mentionsCompany) {
    return false;
  }

  return /^(generated|untitled|my)\s+resume$/i.test(storedTitle) || /resume$/i.test(storedTitle);
}

export function deriveResumeIdentity(params: {
  storedTitle?: string | null;
  storedTargetRole?: string | null;
  storedTargetCompany?: string | null;
  parsedTarget?: { role?: string | null; company?: string | null } | null;
  resumeData?: ResumeData | null;
  fallbackTitle?: string | null;
}): {
  title: string;
  targetRole: string | null;
  targetCompany: string | null;
} {
  const resolvedTarget = resolveResumeTarget({
    targetRole: params.parsedTarget?.role,
    targetCompany: params.parsedTarget?.company,
    fallbackTargetRole: params.storedTargetRole,
    fallbackTargetCompany: params.storedTargetCompany,
    resumeRole: params.resumeData?.personalInfo.title ?? params.resumeData?.experience[0]?.role ?? null,
  });

  const derivedTitle = buildResumeTitle({
    targetRole: resolvedTarget.targetRole,
    targetCompany: resolvedTarget.targetCompany,
    fallbackTitle: params.fallbackTitle,
  });

  return {
    title: shouldPreferDerivedResumeTitle({
      storedTitle: params.storedTitle,
      targetRole: resolvedTarget.targetRole,
      targetCompany: resolvedTarget.targetCompany,
    })
      ? derivedTitle
      : normalizeValue(params.storedTitle) ?? derivedTitle,
    targetRole: resolvedTarget.targetRole,
    targetCompany: resolvedTarget.targetCompany,
  };
}
