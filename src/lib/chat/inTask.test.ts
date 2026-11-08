import { describe, expect, test } from 'bun:test';
import { decideInTaskByCode } from './inTask';

describe('decideInTaskByCode', () => {
    test('edits the code is sure about', () => {
        for (const text of ['shorter', 'Make it shorter.', 'stronger', 'warmer!']) expect(decideInTaskByCode(text)).toBe('revise');
    });
    test('finished', () => {
        for (const text of ['done', 'Sent it, thanks', 'sent it thanks!', 'looks good, thank you', 'perfect']) expect(decideInTaskByCode(text)).toBe('done');
        // The apply chain's last step (docs/impl/07-telegram-apply.md §5): no model call to hear it.
        for (const text of ['just sent it', "I've sent it", 'applied!', 'sent the email', 'submitted']) expect(decideInTaskByCode(text)).toBe('done');
    });
    test('never an edit: links, commands, long pastes', () => {
        expect(decideInTaskByCode('https://jobs.lever.co/acme/123')).toBe('other');
        expect(decideInTaskByCode('/jobs')).toBe('other');
        expect(decideInTaskByCode('x'.repeat(700))).toBe('other');
    });
    test('everything else asks the model', () => {
        expect(decideInTaskByCode('add that I went to IIT Delhi')).toBeNull();
        expect(decideInTaskByCode('make me sound more senior')).toBeNull();
    });
});
