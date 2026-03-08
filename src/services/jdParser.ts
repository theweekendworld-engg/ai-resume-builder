import { z } from 'zod';
import { ParsedJDSchema } from '@/lib/aiSchemas';

const BOILERPLATE_SECTIONS = [
  /equal opportunity employer[\s\S]*$/i,
  /benefits[\s\S]*$/i,
  /how to apply[\s\S]*$/i,
  /about (the )?company[\s\S]*$/i,
];

const URL_ONLY_PATTERN = /^https?:\/\/\S+$/i;

export function preprocessJobDescription(raw: string): { cleaned: string; searchText: string } {
  let text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    throw new Error('Job description is required');
  }
  if (URL_ONLY_PATTERN.test(text)) {
    throw new Error('Please paste the full job description text instead of a URL');
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (text.length < 100 || wordCount < 20) {
    throw new Error('Job description is too short. Please provide at least 20 words of job details');
  }
  for (const pattern of BOILERPLATE_SECTIONS) {
    text = text.replace(pattern, '').trim();
  }
  return { cleaned: text, searchText: text.slice(0, 15000) };
}

export type ParsedJD = z.infer<typeof ParsedJDSchema>;
