/**
 * Memory topics and formatting: pure, no database.
 *
 * The production case this exists for (2026-11-08): tailoring asked about
 * "Claude" of a user whose record says his Plivo agent runs on Anthropic
 * models. These assert that the record now answers it, that two spellings
 * of one skill are one topic, and that the note the user sees says what was
 * used.
 */

import { describe, expect, test } from 'bun:test';
import {
    canonicalKey,
    normalizeForMatch,
    recordEvidences,
    relatedKeys,
    skillKey,
    slugify,
    textMentions,
} from './topics';
import {
    MEMORY_INDEX_MAX_CHARS,
    MEMORY_TEXT_MAX,
    memoryTextFromAnswer,
    rememberedNote,
    renderMemoryIndex,
    shortDate,
    type RememberedAnswer,
} from './format';
import { weekKeyFor } from './week';

describe('topic keys are derived in code', () => {
    test('one key per skill, whatever the spelling', () => {
        expect(skillKey('Claude')).toBe('skill:claude');
        expect(skillKey('  claude ')).toBe('skill:claude');
        expect(skillKey('Claude API')).toBe('skill:claude');
        expect(skillKey('Kubernetes')).toBe('skill:kubernetes');
        expect(skillKey('K8s')).toBe('skill:kubernetes');
        expect(skillKey('PostgreSQL')).toBe('skill:postgres');
        expect(skillKey('Node.js')).toBe('skill:node');
        expect(skillKey('Model Context Protocol (MCP)')).toBe('skill:mcp');
        expect(skillKey('LLMs')).toBe('skill:llm');
        expect(skillKey('CI/CD')).toBe('skill:ci_cd');
        expect(skillKey('C++')).toBe('skill:cpp');
        expect(skillKey('C#')).toBe('skill:csharp');
    });

    test('nothing to key on is null, not a junk key', () => {
        expect(skillKey('')).toBeNull();
        expect(skillKey('!!!')).toBeNull();
    });

    test('a long requirement is cut to a bounded slug', () => {
        expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(48);
    });

    test('stored aliases fold onto the canonical key; other kinds are untouched', () => {
        expect(canonicalKey('skill:k8s')).toBe('skill:kubernetes');
        expect(canonicalKey('skill:kubernetes')).toBe('skill:kubernetes');
        expect(canonicalKey('pref:work_mode')).toBe('pref:work_mode');
    });
});

describe('the record answers a skill it already shows', () => {
    const plivo = normalizeForMatch('Built the voice agent at Plivo; it uses Anthropic models for intent and replies.');

    test('"Anthropic models" evidences Claude (the production question)', () => {
        expect(recordEvidences('Claude', plivo)).toBe(true);
        expect(recordEvidences('Anthropic', normalizeForMatch('Shipped a Claude-based support bot'))).toBe(true);
    });

    test('LLM and generative AI are evidenced by a named model', () => {
        expect(recordEvidences('LLMs', plivo)).toBe(true);
        expect(recordEvidences('Generative AI', plivo)).toBe(true);
    });

    test('aliases match whole words only: "go" is not in "google"', () => {
        expect(recordEvidences('Golang', normalizeForMatch('Worked at Google on search'))).toBe(false);
        expect(recordEvidences('Kubernetes', normalizeForMatch('Ran services on EKS'))).toBe(true);
        expect(recordEvidences('Kubernetes', normalizeForMatch('Bakeks and cakes'))).toBe(false);
    });

    test('the old substring test still holds for the skill itself', () => {
        expect(recordEvidences('Postgres', normalizeForMatch('PostgreSQL 15 on RDS'))).toBe(true);
    });

    test('nothing evidences what is not there', () => {
        expect(recordEvidences('Terraform', plivo)).toBe(false);
        expect(recordEvidences('Claude', normalizeForMatch('Python and FastAPI services'))).toBe(false);
    });
});

describe('recall keys and text matches', () => {
    test('a Claude memory answers Anthropic and LLMs', () => {
        expect(relatedKeys('Anthropic')).toContain('skill:claude');
        expect(relatedKeys('LLMs')).toContain('skill:claude');
        expect(relatedKeys('Claude')[0]).toBe('skill:claude');
    });

    test('a memory whose text names the skill (or an alias) matches it', () => {
        expect(textMentions('Built an MCP server for our agent', 'MCP')).toBe(true);
        expect(textMentions('Voice agent on Anthropic models', 'Claude')).toBe(true);
        expect(textMentions('Built a payments API', 'MCP')).toBe(false);
    });
});

describe('an answer as a memory line', () => {
    test('keeps the user\'s words, drops a leading yes, collapses whitespace', () => {
        expect(memoryTextFromAnswer('Yes,   I built the Plivo voice agent on Claude Sonnet')).toBe('I built the Plivo voice agent on Claude Sonnet');
        expect(memoryTextFromAnswer('yeah - MCP server for internal tools')).toBe('MCP server for internal tools');
    });

    test('a bare yes is nothing to remember', () => {
        expect(memoryTextFromAnswer('Yes')).toBe('');
        expect(memoryTextFromAnswer('   ')).toBe('');
    });

    test('is capped at a word boundary', () => {
        const text = memoryTextFromAnswer('word '.repeat(200));
        expect(text.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
        expect(text.endsWith('…')).toBe(true);
    });
});

describe('the "used what you told me" note', () => {
    const one: RememberedAnswer = { gap: 'Claude', key: 'skill:claude', memoryId: 'm1', text: 'Voice agent on Claude at Plivo', savedAt: '2026-11-08T10:00:00.000Z' };

    test('says the date and the words used', () => {
        const note = rememberedNote([one]);
        expect(note).toContain('Used what you told me on Nov 8');
        expect(note).toContain('Voice agent on Claude at Plivo');
        expect(note).toContain('Settings → Memory');
    });

    test('one memory answering two requirements is said once', () => {
        const note = rememberedNote([one, { ...one, gap: 'LLMs' }]) ?? '';
        expect(note).toContain('(Claude, LLMs)');
        expect(note.match(/Voice agent on Claude/g)?.length).toBe(1);
    });

    test('several memories are listed', () => {
        const note = rememberedNote([one, { gap: 'MCP', key: 'skill:mcp', memoryId: 'm2', text: 'MCP server for tools', savedAt: '2026-11-01T00:00:00.000Z' }]) ?? '';
        expect(note).toContain('Used what you told me before');
        expect(note).toContain('• MCP (Nov 1): MCP server for tools');
    });

    test('nothing used, nothing said', () => {
        expect(rememberedNote([])).toBeNull();
        expect(rememberedNote(undefined)).toBeNull();
    });

    test('dates are UTC', () => {
        expect(shortDate('2026-11-08T23:59:00.000Z')).toBe('Nov 8');
    });
});

describe('the prompt index', () => {
    test('one line per memory, in the order given, within the budget', () => {
        const entries = Array.from({ length: 100 }, (_, i) => ({ key: `skill:s${i}`, label: `Skill ${i}`, text: `Used skill ${i} in production for two years at work` }));
        const index = renderMemoryIndex(entries);
        expect(index.length).toBeLessThanOrEqual(MEMORY_INDEX_MAX_CHARS);
        const lines = index.split('\n');
        expect(lines[0]).toBe('- Skill 0: Used skill 0 in production for two years at work');
        expect(lines[1].startsWith('- Skill 1:')).toBe(true);
    });

    test('a line too long to fit is skipped, shorter ones after it still go in', () => {
        const index = renderMemoryIndex([
            { key: 'skill:a', label: 'A', text: 'x'.repeat(2_000) },
            { key: 'skill:b', label: 'B', text: 'short' },
        ]);
        expect(index).toBe('- B: short');
    });

    test('empty when there is nothing', () => {
        expect(renderMemoryIndex([])).toBe('');
    });
});

describe('the consolidation week', () => {
    test('is the Monday of the week, UTC', () => {
        expect(weekKeyFor(new Date('2026-11-08T12:00:00Z'))).toBe('2026-11-02'); // a Sunday
        expect(weekKeyFor(new Date('2026-11-09T00:00:00Z'))).toBe('2026-11-09'); // a Monday
        expect(weekKeyFor(new Date('2026-11-11T23:00:00Z'))).toBe('2026-11-09');
    });
});
