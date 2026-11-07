import { describe, expect, test } from 'bun:test';

import { joinTextItems } from '@/lib/pdfParser';
import {
    extendToSentence,
    extractBullets,
    extractSkillGroups,
    findSpan,
    headingKind,
    isPresentInSource,
    normalizeSourceText,
    noteAfter,
    readLines,
    splitItems,
    stackAfter,
    verbatimFromSource,
} from './sourceText';

describe('normalizeSourceText', () => {
    test('drops page markers, expands ligatures, collapses spaces, never changes a word', () => {
        const raw = 'Built  a ﬁle store\r\n\n\n\n-- 1 of 2 --\nShipped it';
        expect(normalizeSourceText(raw)).toBe('Built a file store\n\nShipped it');
    });

    test('a page with no line structure gets one line per marked bullet', () => {
        const flat = `EXPERIENCE Acme ${Array.from({ length: 6 }, (_, i) => `• Did thing number ${i} with a description long enough to matter on a real page`).join(' ')}`;
        expect(flat.length).toBeGreaterThan(400);
        const lines = normalizeSourceText(flat).split('\n');
        expect(lines.filter((line) => line.startsWith('• '))).toHaveLength(6);
    });
});

describe('extractBullets', () => {
    const lines = readLines(
        normalizeSourceText(`EXPERIENCE
Plivo (established CPaaS) Bengaluru
Software Engineer I | Go, C Sep 2025 – Present
• Optimized the media path and shipped noise cancellation, used on
7.5M calls, raising capacity 2x per machine.
• Designed a protocol, cutting negotiation from 75s to 13s at half the cost.
When the other side is a human, the agent stays in voice.
Hyperbots (seed-stage fintech AI) Bengaluru
Software Engineer I | Java Jun 2024 – Aug 2025
• Cut API response times by 40% with missing indexes.
2Sigma School, SDE Intern. Built a code execution engine
(Pyodide, Cloud Run), cutting cost 70%.
Mar – May 2024
PROJECTS
Tonecall | TypeScript repo
• Built the telephony runtime.
SKILLS
Languages: Python, Go`),
    );
    const bullets = extractBullets(lines).map((bullet) => bullet.text);

    test('a wrapped bullet is joined into one line', () => {
        expect(bullets[0]).toBe('Optimized the media path and shipped noise cancellation, used on 7.5M calls, raising capacity 2x per machine.');
    });

    test('a second sentence on its own line stays with its bullet', () => {
        expect(bullets[1]).toBe('Designed a protocol, cutting negotiation from 75s to 13s at half the cost. When the other side is a human, the agent stays in voice.');
    });

    test('a header line after a finished bullet is not absorbed into it', () => {
        expect(bullets[1]).not.toContain('Hyperbots');
        expect(bullets[2]).toBe('Cut API response times by 40% with missing indexes.');
    });

    test('a one-line role after the last bullet is not absorbed either', () => {
        expect(bullets.some((bullet) => bullet.includes('2Sigma'))).toBe(false);
    });

    test('headings end a bullet; skills rows are never bullets', () => {
        expect(bullets[3]).toBe('Built the telephony runtime.');
        expect(bullets).toHaveLength(4);
    });

    test('an entry header the caller located is a hard stop', () => {
        const tricky = readLines('• Shipped the thing for the team.\nAcme Corp has shipped many things.\n• Next one.');
        expect(extractBullets(tricky).map((b) => b.text)[0]).toContain('Acme Corp');
        expect(extractBullets(tricky, new Set([1])).map((b) => b.text)[0]).toBe('Shipped the thing for the team.');
    });
});

describe('findSpan: the verbatim guard', () => {
    const source = 'Cut API response times by 40% with missing indexes, rewrites of the slowest queries and schema fixes.';

    test('exact match ignores case, spacing and punctuation', () => {
        expect(findSpan('cut api response times by 40%  with missing indexes', source)?.exact).toBe(true);
    });

    test('near match tolerates a fixed typo', () => {
        const span = findSpan('Cut API response time by 40% with missing indexes, rewrites of the slowest queries and schema fixes.', source);
        expect(span).not.toBeNull();
        expect(span?.exact).toBe(false);
    });

    test('a changed number never matches, however close the words', () => {
        expect(findSpan('Cut API response times by 45% with missing indexes, rewrites of the slowest queries and schema fixes.', source)).toBeNull();
    });

    test('an invented line is not present', () => {
        expect(isPresentInSource('Built fintech AI backend services using Java and Python.', source)).toBe(false);
    });

    test('the stored text is the source\'s, not the candidate\'s', () => {
        expect(verbatimFromSource('cut API response times by 40 with missing indexes', source)).toBe('Cut API response times by 40% with missing indexes');
    });
});

describe('extendToSentence', () => {
    const region = '2Sigma School, SDE Intern. Built a safe, fast remote and in-browser code execution engine\n(Pyodide, Cloud Run), cutting cost 70%.\nMar – May 2024';

    test('a clause cut before its metric is read out to the end of the sentence', () => {
        const span = findSpan('Built a safe, fast remote and in-browser code execution engine.', region)!;
        expect(extendToSentence(region, span)).toBe('Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70%.');
    });

    test('a full sentence is returned unchanged, without the company or the dates', () => {
        const span = findSpan('Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70%.', region)!;
        expect(extendToSentence(region, span)).toBe('Built a safe, fast remote and in-browser code execution engine (Pyodide, Cloud Run), cutting cost 70%.');
    });
});

describe('skills rows', () => {
    test('labels as written; commas inside brackets do not split; wrapped rows continue', () => {
        const lines = readLines('SKILLS\nSpeech / AI: PyTorch, ASR (Conformer, CTC), TTS\nBackend / Infra: FastAPI, Prometheus,\nGrafana\nGit, Linux');
        expect(extractSkillGroups(lines)).toEqual([
            { label: 'Speech / AI', items: ['PyTorch', 'ASR (Conformer, CTC)', 'TTS'] },
            { label: 'Backend / Infra', items: ['FastAPI', 'Prometheus', 'Grafana'] },
            { label: '', items: ['Git', 'Linux'] },
        ]);
    });

    test('splitItems understands the separators people use', () => {
        expect(splitItems('Go • Rust · C++ | Zig; Odin')).toEqual(['Go', 'Rust', 'C++', 'Zig', 'Odin']);
    });
});

describe('headers', () => {
    test('headings are a vocabulary, not any capitalised line', () => {
        expect(headingKind('EXPERIENCE')).toBe('experience');
        expect(headingKind('Technical Skills:')).toBe('skills');
        expect(headingKind('Languages: Python, Go')).toBeNull();
        expect(headingKind('JAI SHANKAR')).toBeNull();
    });

    test('tag line and stack are read from the header, in its own words', () => {
        expect(noteAfter('Plivo (established CPaaS, AI voice agents) Bengaluru', 'Plivo')).toBe('established CPaaS, AI voice agents');
        expect(noteAfter('Plivo Bengaluru', 'Plivo')).toBe('');
        expect(stackAfter('Software Engineer I | Java (Spring Boot), Python (FastAPI) Jun 2024 – Aug 2025', 'Software Engineer I')).toBe('Java (Spring Boot), Python (FastAPI)');
        expect(stackAfter('Software Engineer I Jun 2024 – Aug 2025', 'Software Engineer I')).toBe('');
    });
});

describe('pdfjs text keeps its lines', () => {
    test('items join into lines at hasEOL and at a baseline change', () => {
        const text = joinTextItems([
            { str: 'EXPERIENCE', hasEOL: true, transform: [0, 0, 0, 0, 0, 700] },
            { str: '•', transform: [0, 0, 0, 0, 0, 690] },
            { str: ' ', transform: [0, 0, 0, 0, 0, 690] },
            { str: 'Built   it', transform: [0, 0, 0, 0, 0, 690] },
            { str: 'Shipped it', transform: [0, 0, 0, 0, 0, 680] },
        ]);
        expect(text).toBe('EXPERIENCE\n• Built it\nShipped it');
    });
});
