import { describe, expect, test } from 'bun:test';

import { NAV_GROUPS, NAV_ROUTES, type NavDestination } from './navRoutes';

describe('sidebar groups', () => {
    test('every destination appears in exactly one group', () => {
        const listed = NAV_GROUPS.flatMap((group) => group.items);
        expect([...listed].sort()).toEqual((Object.keys(NAV_ROUTES) as NavDestination[]).sort());
        expect(new Set(listed).size).toBe(listed.length);
    });

    test('Search leads with Home, Record leads with My work', () => {
        expect(NAV_GROUPS[0]).toMatchObject({ label: 'Job search' });
        expect(NAV_GROUPS[0].items[0]).toBe('overview');
        expect(NAV_GROUPS[1]).toMatchObject({ label: 'Your career' });
        expect(NAV_GROUPS[1].items[0]).toBe('log');
    });
});
