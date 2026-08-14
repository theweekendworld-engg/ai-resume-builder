import { describe, expect, test } from 'bun:test';
import {
  ExtensionCompanyInsightRequestSchema,
  ExtensionReducedRegionSchema,
  ExtensionWorkspaceUpsertRequestSchema,
  normalizeExtensionRequestBody,
} from '@/lib/extension/schemas';

describe('normalizeExtensionRequestBody', () => {
  test('treats null optional extension fields as omitted values', () => {
    const normalized = normalizeExtensionRequestBody({
      workspaceId: 'cmo4bqvzq000y65g41gwwb0kb',
      companyName: '(1) Top job picks for you',
      roleTitle: '0 notifications',
      sourceUrl: 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4402936563',
      jobDescription: null,
      forceRefresh: false,
    });

    const parsed = ExtensionCompanyInsightRequestSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.jobDescription).toBeUndefined();
    }
  });

  test('keeps required fields required after null normalization', () => {
    const normalized = normalizeExtensionRequestBody({
      sourceUrl: null,
      jobDescription: null,
    });

    const parsed = ExtensionWorkspaceUpsertRequestSchema.safeParse(normalized);
    expect(parsed.success).toBe(false);
  });
});

describe('ExtensionReducedRegionSchema elementPath coercion', () => {
  const baseRegion = {
    id: 'r1',
    kind: 'form' as const,
    textSample: '',
    visibleTextLength: 0,
    interactiveCount: 0,
    score: 0.5,
  };

  test('blank elementPath coerces to "body"', () => {
    const parsed = ExtensionReducedRegionSchema.safeParse({
      ...baseRegion,
      elementPath: '',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.elementPath).toBe('body');
    }
  });

  test('whitespace-only elementPath coerces to "body"', () => {
    const parsed = ExtensionReducedRegionSchema.safeParse({
      ...baseRegion,
      elementPath: '   ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.elementPath).toBe('body');
    }
  });

  test('real selector path is preserved unchanged', () => {
    const parsed = ExtensionReducedRegionSchema.safeParse({
      ...baseRegion,
      elementPath: 'body > main:nth-of-type(1) > form:nth-of-type(1)',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.elementPath).toBe('body > main:nth-of-type(1) > form:nth-of-type(1)');
    }
  });
});
