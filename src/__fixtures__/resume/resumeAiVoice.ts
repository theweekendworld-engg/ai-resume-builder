/**
 * The owner's resume_ai_voice, as the product imports it.
 *
 * `resume_ai_voice.txt` is the text extracted from his PDF. A model that
 * copies perfectly (the FAITHFUL script in `importEval.test.ts`, plus the
 * links the PDF's annotations carry) goes through the same pure steps the
 * import runs after the model call: `toParsedResume`, `reconcileWithSource`,
 * `resumeDataFromParsed`. What comes out is the document the templates get.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { reconcileWithSource } from '@/lib/resume/faithfulImport';
import { resumeDataFromParsed } from '@/lib/resume/fromParsed';
import { toParsedResume, type ImportParse } from '@/lib/resume/importParse';
import type { ResumeData } from '@/types/resume';

export const RESUME_AI_VOICE_TEXT = readFileSync(join(import.meta.dir, 'resume_ai_voice.txt'), 'utf8');

const role = (company: string, rest: Partial<ImportParse['experiences'][number]>): ImportParse['experiences'][number] => ({
    company,
    companyNote: '',
    role: 'Software Engineer I',
    stack: '',
    location: 'Bengaluru',
    startDate: '',
    endDate: '',
    current: false,
    bullets: [],
    ...rest,
});

/** Lines as the source prints them; reconciliation reads the real ones back from the text. */
const MODEL_OUTPUT: ImportParse = {
    personalInfo: {
        fullName: 'Jai Shankar',
        title: 'AI Engineer, Voice Agents',
        email: 'jaimauryatech@gmail.com',
        phone: '+91 76440 53913',
        location: 'Bengaluru, India',
        linkedin: 'linkedin.com/in/jai-shankar-b7b388234',
        github: 'github.com/jai0651',
        website: 'jaishankar.dev',
        summary: '',
    },
    experiences: [
        role('Plivo', { companyNote: 'established CPaaS, AI voice agents', stack: 'Go, C, Python', startDate: 'Sep 2025', endDate: 'Present', current: true }),
        role('Hyperbots', { companyNote: 'seed-stage fintech AI', stack: 'Java (Spring Boot), Python (FastAPI)', startDate: 'Jun 2024', endDate: 'Aug 2025' }),
        role('2Sigma School', {
            role: 'SDE Intern',
            location: '',
            startDate: 'Mar 2024',
            endDate: 'May 2024',
            bullets: ['Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70%.'],
        }),
        role('Swachh.io', {
            role: 'SDE Intern',
            location: '',
            startDate: 'May 2023',
            endDate: 'Jul 2023',
            bullets: ['Built a Flutter affiliate app on Shopify with referrals, rewards, payments.'],
        }),
    ],
    education: [
        { institution: 'Indian Institute of Technology Delhi', degree: 'B.Tech', fieldOfStudy: 'Engineering and Computational Mechanics', startDate: '2020', endDate: '2024', current: false },
    ],
    projects: [
        { name: 'Voice agent from scratch', technologies: [], githubUrl: 'https://github.com/jai0651/VAD-ASR', liveUrl: '', bullets: [] },
        { name: 'Tonecall: agent-to-agent call protocol', technologies: [], githubUrl: 'https://github.com/jai0651/tonecall', liveUrl: '', bullets: [] },
        {
            name: 'Patronus: AI career companion',
            technologies: [],
            githubUrl: 'https://github.com/theweekendworld-engg/ai-resume-builder',
            liveUrl: 'https://patronus.cv',
            bullets: [],
        },
    ],
    achievements: [],
    skillGroups: [],
};

export function resumeAiVoiceData(): ResumeData {
    const { data } = reconcileWithSource(toParsedResume(structuredClone(MODEL_OUTPUT)), RESUME_AI_VOICE_TEXT);
    return resumeDataFromParsed(data);
}
