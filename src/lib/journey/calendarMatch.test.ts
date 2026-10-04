import { describe, expect, test } from 'bun:test';
import { matchEvent, type CalendarCandidate } from './calendarMatch';

const ACME: CalendarCandidate = { workspaceId: 'w-acme', company: 'Acme', knownDomains: ['acme.com'] };
const GLOBEX: CalendarCandidate = { workspaceId: 'w-globex', company: 'Globex Corporation', knownDomains: [] };
const ev = (over: Record<string, unknown>) => ({ id: 'e1', summary: '', ...over });

describe('matchEvent', () => {
    test('company in the title plus an interview word is that job', () => {
        expect(matchEvent(ev({ summary: 'Globex Corporation - Technical interview' }), [ACME, GLOBEX])).toBe('w-globex');
    });

    test('an attendee from a domain that emailed about the job is that job, whatever the title', () => {
        expect(matchEvent(ev({ summary: 'Quick sync', attendees: [{ email: 'me@gmail.com', self: true }, { email: 'priya@acme.com' }] }), [ACME, GLOBEX])).toBe('w-acme');
    });

    test('a company named without an interview word is not an interview', () => {
        expect(matchEvent(ev({ summary: 'Lunch near Acme office' }), [ACME])).toBeNull();
    });

    test('interview words alone, or hosted-ATS attendees, match nothing', () => {
        expect(matchEvent(ev({ summary: 'Interview prep' }), [ACME, GLOBEX])).toBeNull();
        expect(matchEvent(ev({ summary: 'Call', attendees: [{ email: 'scheduler@greenhouse.io' }] }), [ACME])).toBeNull();
    });

    test('cancelled events and ties match nothing', () => {
        expect(matchEvent(ev({ summary: 'Acme interview', status: 'cancelled' }), [ACME])).toBeNull();
        const twin: CalendarCandidate = { workspaceId: 'w-acme-2', company: 'Acme', knownDomains: [] };
        expect(matchEvent(ev({ summary: 'Acme interview' }), [{ ...ACME, knownDomains: [] }, twin])).toBeNull();
    });
});
