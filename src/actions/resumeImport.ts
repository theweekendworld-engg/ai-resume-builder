'use server';

import { auth } from '@clerk/nextjs/server';
import { KnowledgeType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ParsedResumeData } from '@/lib/aiSchemas';
import { upsertUserProfile } from '@/actions/profile';
import { createUserExperience } from '@/actions/experiences';
import { createUserEducation } from '@/actions/education';
import { createUserProject } from '@/actions/projects';
import { createKnowledgeItem } from '@/actions/kb';

export type ImportOptions = {
  mergeProfile: boolean;
  sections: {
    experience: boolean;
    education: boolean;
    projects: boolean;
    achievements: boolean;
  };
};

export type SectionSummary = {
  created: number;
  skipped: number;
  failed: number;
};

export type ImportSummary = {
  profile: 'updated' | 'skipped';
  experience: SectionSummary;
  education: SectionSummary;
  projects: SectionSummary;
  achievements: SectionSummary;
  warnings: string[];
};

const KNOWLEDGE_TYPE_MAP: Record<string, KnowledgeType> = {
  achievement: KnowledgeType.achievement,
  oss_contribution: KnowledgeType.oss_contribution,
  certification: KnowledgeType.certification,
  award: KnowledgeType.award,
  publication: KnowledgeType.publication,
  custom: KnowledgeType.custom,
};

function normalizeGithubRepoUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/\.git$/i, '');
  if (!raw) return null;

  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = segments[0].toLowerCase();
    const repo = segments[1].toLowerCase();
    if (!owner || !repo) return null;

    return `github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

export async function importParsedResumeData(
  data: ParsedResumeData,
  options: ImportOptions
): Promise<{ success: boolean; summary?: ImportSummary; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Not authenticated' };

  const summary: ImportSummary = {
    profile: 'skipped',
    experience: { created: 0, skipped: 0, failed: 0 },
    education: { created: 0, skipped: 0, failed: 0 },
    projects: { created: 0, skipped: 0, failed: 0 },
    achievements: { created: 0, skipped: 0, failed: 0 },
    warnings: [],
  };

  if (options.mergeProfile) {
    const pi = data.personalInfo;
    const hasData =
      pi.fullName || pi.email || pi.phone || pi.linkedin || pi.github || pi.summary || pi.title;

    if (hasData) {
      const existing = await prisma.userProfile.findUnique({
        where: { userId },
        select: {
          fullName: true,
          email: true,
          phone: true,
          linkedin: true,
          github: true,
          defaultSummary: true,
          defaultTitle: true,
          location: true,
          website: true,
        },
      });

      await upsertUserProfile({
        fullName: pi.fullName || existing?.fullName || '',
        email: pi.email || existing?.email || '',
        phone: pi.phone || existing?.phone || '',
        location: pi.location || existing?.location || '',
        website: pi.website || existing?.website || '',
        linkedin: pi.linkedin || existing?.linkedin || '',
        github: pi.github || existing?.github || '',
        defaultTitle: pi.title || existing?.defaultTitle || '',
        defaultSummary: pi.summary || existing?.defaultSummary || '',
      });
      summary.profile = 'updated';
    }
  }

  if (options.sections.experience) {
    const existing = await prisma.userExperience.findMany({
      where: { userId },
      select: { company: true, role: true },
    });
    const existingSet = new Set(
      existing.map((e) => `${e.company.toLowerCase()}|${e.role.toLowerCase()}`)
    );

    for (const exp of data.experiences) {
      if (!exp.company || !exp.role) {
        summary.experience.skipped++;
        continue;
      }
      const key = `${exp.company.toLowerCase()}|${exp.role.toLowerCase()}`;
      if (existingSet.has(key)) {
        summary.experience.skipped++;
        continue;
      }
      const result = await createUserExperience({
        company: exp.company,
        role: exp.role,
        startDate: exp.startDate || 'Unknown',
        endDate: exp.endDate || '',
        current: exp.current,
        location: exp.location,
        description: exp.description,
        highlights: exp.highlights,
      });
      if (result.success) {
        summary.experience.created++;
        existingSet.add(key);
      } else {
        summary.experience.failed++;
        if (result.error) summary.warnings.push(`Experience "${exp.role}": ${result.error}`);
      }
    }
  }

  if (options.sections.education) {
    const existing = await prisma.userEducation.findMany({
      where: { userId },
      select: { institution: true, degree: true },
    });
    const existingSet = new Set(
      existing.map((e) => `${e.institution.toLowerCase()}|${e.degree.toLowerCase()}`)
    );

    for (const edu of data.education) {
      if (!edu.institution || !edu.degree) {
        summary.education.skipped++;
        continue;
      }
      const key = `${edu.institution.toLowerCase()}|${edu.degree.toLowerCase()}`;
      if (existingSet.has(key)) {
        summary.education.skipped++;
        continue;
      }
      const result = await createUserEducation({
        institution: edu.institution,
        degree: edu.degree,
        fieldOfStudy: edu.fieldOfStudy,
        startDate: edu.startDate || 'Unknown',
        endDate: edu.endDate || '',
        current: edu.current,
      });
      if (result.success) {
        summary.education.created++;
        existingSet.add(key);
      } else {
        summary.education.failed++;
        if (result.error) summary.warnings.push(`Education "${edu.institution}": ${result.error}`);
      }
    }
  }

  if (options.sections.projects) {
    const existing = await prisma.userProject.findMany({
      where: { userId },
      select: { name: true, githubUrl: true },
    });
    const existingNamesWithoutRepo = new Set<string>();
    const existingGithubRepos = new Set<string>();

    for (const project of existing) {
      const normalizedRepo = normalizeGithubRepoUrl(project.githubUrl);
      if (normalizedRepo) {
        existingGithubRepos.add(normalizedRepo);
      } else {
        existingNamesWithoutRepo.add(project.name.trim().toLowerCase());
      }
    }

    for (const proj of data.projects) {
      const normalizedName = proj.name.trim().toLowerCase();
      if (!normalizedName) {
        summary.projects.skipped++;
        summary.warnings.push('Skipped one project because it has no name.');
        continue;
      }

      const normalizedGithubRepo = normalizeGithubRepoUrl(proj.githubUrl ?? null);
      const duplicateByRepo = normalizedGithubRepo
        ? existingGithubRepos.has(normalizedGithubRepo)
        : false;
      const duplicateByNameWithoutRepo = !normalizedGithubRepo
        ? existingNamesWithoutRepo.has(normalizedName)
        : false;

      if (duplicateByRepo || duplicateByNameWithoutRepo) {
        summary.projects.skipped++;
        summary.warnings.push(
          `Project "${proj.name}": skipped as duplicate (${duplicateByRepo ? 'same GitHub repo' : 'same name'}).`
        );
        continue;
      }

      const result = await createUserProject({
        name: proj.name,
        description: proj.description,
        url: proj.liveUrl || proj.githubUrl || '',
        githubUrl: proj.githubUrl || undefined,
        technologies: proj.technologies,
        source: normalizedGithubRepo ? 'github' : 'pdf_resume',
      });

      if (result.success) {
        summary.projects.created++;
        if (normalizedGithubRepo) {
          existingGithubRepos.add(normalizedGithubRepo);
        } else {
          existingNamesWithoutRepo.add(normalizedName);
        }
        if (result.warning) summary.warnings.push(`Project "${proj.name}": ${result.warning}`);
      } else {
        summary.projects.failed++;
        if (result.error) summary.warnings.push(`Project "${proj.name}": ${result.error}`);
      }
    }
  }

  if (options.sections.achievements) {
    const existing = await prisma.knowledgeItem.findMany({
      where: { userId },
      select: { title: true },
    });
    const existingTitles = new Set(existing.map((k) => k.title.toLowerCase()));

    for (const ach of data.achievements) {
      if (!ach.title || !ach.description) {
        summary.achievements.skipped++;
        continue;
      }
      if (existingTitles.has(ach.title.toLowerCase())) {
        summary.achievements.skipped++;
        continue;
      }
      const knowledgeType = KNOWLEDGE_TYPE_MAP[ach.type] ?? KnowledgeType.achievement;
      const result = await createKnowledgeItem({
        type: knowledgeType,
        title: ach.title,
        content: ach.description,
      });
      if (result.success) {
        summary.achievements.created++;
        existingTitles.add(ach.title.toLowerCase());
        if ('warning' in result && result.warning)
          summary.warnings.push(`Achievement "${ach.title}": ${result.warning}`);
      } else {
        summary.achievements.failed++;
        if (result.error) summary.warnings.push(`Achievement "${ach.title}": ${result.error}`);
      }
    }
  }

  return { success: true, summary };
}
