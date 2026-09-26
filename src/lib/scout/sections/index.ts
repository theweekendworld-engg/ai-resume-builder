import type { ScoutSection } from '@/lib/scout/section';
import type { ScoutSectionName } from '@/lib/scout/types';
import { classifySection } from '@/lib/scout/sections/classify';
import { companySection } from '@/lib/scout/sections/company';
import { compSection } from '@/lib/scout/sections/comp';
import { digestSection } from '@/lib/scout/sections/digest';
import { fitSection } from '@/lib/scout/sections/fit';
import { ingestSection } from '@/lib/scout/sections/ingest';
import { interviewsSection } from '@/lib/scout/sections/interviews';
import { jdSection } from '@/lib/scout/sections/jd';
import { networkSection } from '@/lib/scout/sections/network';
import { openingsSection } from '@/lib/scout/sections/openings';
import { talentSection } from '@/lib/scout/sections/talent';
import { captureSection } from '@/lib/scout/sections/capture';
import { trackSection } from '@/lib/scout/sections/track';

export const SCOUT_SECTION_IMPLS: { [K in ScoutSectionName]: ScoutSection<K> } = {
    ingest: ingestSection,
    classify: classifySection,
    jd: jdSection,
    fit: fitSection,
    company: companySection,
    comp: compSection,
    interviews: interviewsSection,
    network: networkSection,
    talent: talentSection,
    openings: openingsSection,
    digest: digestSection,
    capture: captureSection,
    track: trackSection,
};

/**
 * Per-section harness options. Research is slow; extraction is not.
 * Nothing is `critical` here: `stages.ts` treats a failed preamble section as
 * fatal by return value, because a throw inside a durable step is retried.
 */
export const SCOUT_SECTION_OPTIONS: Record<ScoutSectionName, { timeoutMs: number; maxAttempts: number }> = {
    ingest: { timeoutMs: 20_000, maxAttempts: 2 },
    classify: { timeoutMs: 20_000, maxAttempts: 2 },
    jd: { timeoutMs: 40_000, maxAttempts: 2 },
    fit: { timeoutMs: 40_000, maxAttempts: 2 },
    company: { timeoutMs: 45_000, maxAttempts: 1 },
    comp: { timeoutMs: 45_000, maxAttempts: 1 },
    interviews: { timeoutMs: 45_000, maxAttempts: 1 },
    network: { timeoutMs: 20_000, maxAttempts: 1 },
    talent: { timeoutMs: 45_000, maxAttempts: 1 },
    openings: { timeoutMs: 45_000, maxAttempts: 1 },
    digest: { timeoutMs: 30_000, maxAttempts: 2 },
    capture: { timeoutMs: 40_000, maxAttempts: 2 },
    track: { timeoutMs: 10_000, maxAttempts: 2 },
};
