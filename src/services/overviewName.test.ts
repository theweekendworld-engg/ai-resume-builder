import { describe, expect, test } from 'bun:test';
import { firstNameOf } from './overview';

describe('firstNameOf', () => {
    test('a name in capitals from a resume header greets in title case', () => {
        expect(firstNameOf('JAI SHANKAR')).toBe('Jai');
        expect(firstNameOf('jai shankar')).toBe('Jai');
    });
    test("the person's own mixed case is kept", () => {
        expect(firstNameOf('DeShawn Lee')).toBe('DeShawn');
    });
    test('no name, no greeting name', () => {
        expect(firstNameOf(null)).toBeNull();
        expect(firstNameOf('   ')).toBeNull();
    });
});
