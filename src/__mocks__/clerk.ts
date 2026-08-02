/**
 * The Clerk mock — one shape, replacing seven.
 *
 * Clerk is the single boundary where `mock.module` is still the right tool:
 * `auth()` is resolved from request-scoped async storage at import time, and
 * there is no client object to swap. But `mock.module` is PROCESS-GLOBAL in
 * Bun. Seven files each registering their own stub worked only because each
 * happened to register before its own dynamic imports resolved — an ordering
 * accident, not a design, and the eighth file to join in would have broken
 * something unrelated.
 *
 * The fix is not to stop using `mock.module`; it is to call it exactly once,
 * from here, against one module-level identity. Every test file then drives the
 * same object through {@link MockClerk.signIn}, so which file registered last
 * stops mattering.
 *
 * Deterministic: the mock never invents a user id. A test that forgets to sign
 * in sees `userId: null` — the signed-out path — rather than a stale id left
 * behind by whichever file ran before it.
 */

import { mock } from 'bun:test';

export type MockClerkUser = {
    id: string;
    emailAddress: string;
    /** Clerk's `externalAccounts`, read by the GitHub connect paths. */
    externalAccounts: Array<Record<string, unknown>>;
    /** `users.getUserOauthAccessToken` results, keyed by provider. */
    oauthTokens: Record<string, { token: string; scopes: string[] }>;
};

function defaultUser(id: string): MockClerkUser {
    return {
        id,
        // Derived from the id, never random — the same user always has the
        // same address, which matters because email tests join on it.
        emailAddress: `${id}@example.test`,
        externalAccounts: [],
        oauthTokens: {},
    };
}

export class MockClerk {
    /** Whoever `auth()` currently reports. Null is signed out. */
    private currentUserId: string | null = null;
    private readonly users = new Map<string, MockClerkUser>();

    // ── arrange

    /** Sign a user in and return the id, so call sites read `const id = clerk.signIn(...)`. */
    signIn(userId: string): string {
        this.currentUserId = userId;
        if (!this.users.has(userId)) this.users.set(userId, defaultUser(userId));
        return userId;
    }

    signOut(): void {
        this.currentUserId = null;
    }

    get userId(): string | null {
        return this.currentUserId;
    }

    /** Override the profile Clerk would return for a user. */
    setUser(userId: string, patch: Partial<Omit<MockClerkUser, 'id'>>): MockClerkUser {
        const existing = this.users.get(userId) ?? defaultUser(userId);
        const updated = { ...existing, ...patch, id: userId };
        this.users.set(userId, updated);
        return updated;
    }

    getUser(userId: string): MockClerkUser {
        return this.users.get(userId) ?? defaultUser(userId);
    }

    reset(): void {
        this.currentUserId = null;
        this.users.clear();
    }

    // ── the module shape, one superset for all seven call sites

    /**
     * What `mock.module('@clerk/nextjs/server', …)` returns. Deliberately a
     * superset of everything the app imports (`auth`, `currentUser`,
     * `clerkClient`) so no test file ever needs its own variant again.
     */
    moduleShape(): Record<string, unknown> {
        return {
            auth: async () => ({
                userId: this.currentUserId,
                sessionId: this.currentUserId ? `sess_${this.currentUserId}` : null,
                orgId: null,
                sessionClaims: null,
                getToken: async () => null,
                redirectToSignIn: () => {
                    throw new Error('mock clerk: redirectToSignIn called while signed out');
                },
            }),

            currentUser: async () => {
                if (!this.currentUserId) return null;
                const user = this.getUser(this.currentUserId);
                return {
                    id: user.id,
                    emailAddresses: [{ emailAddress: user.emailAddress, id: `idn_${user.id}` }],
                    primaryEmailAddress: { emailAddress: user.emailAddress },
                    externalAccounts: user.externalAccounts,
                };
            },

            clerkClient: async () => ({
                users: {
                    getUser: async (userId: string) => {
                        const user = this.getUser(userId);
                        return {
                            id: user.id,
                            emailAddresses: [{ emailAddress: user.emailAddress, id: `idn_${user.id}` }],
                            externalAccounts: user.externalAccounts,
                        };
                    },
                    getUserOauthAccessToken: async (userId: string, provider: string) => {
                        const entry = this.getUser(userId).oauthTokens[provider];
                        return { data: entry ? [entry] : [] };
                    },
                },
            }),
        };
    }
}

// One instance for the whole process, because `mock.module` is one registration
// for the whole process. Exported so a test file can reach it before
// `installMocks()` has run (the module registration has to happen at import
// time, before the module under test is dynamically imported).
export const mockClerk = new MockClerk();

let installed = false;

/**
 * Register the Clerk module mock. Idempotent — safe to call from every test
 * file, and the second call is a no-op rather than a competing registration.
 *
 * MUST be called at module scope, before the `await import()` of the module
 * under test, because that import is what binds `auth`.
 */
export function installClerkMock(): MockClerk {
    if (!installed) {
        mock.module('@clerk/nextjs/server', () => mockClerk.moduleShape());
        installed = true;
    }

    // Sign out on every install, not only the first.
    //
    // Bun runs every test file in one process and `mockClerk` is a single
    // shared instance, so a file whose last test signed in leaks that identity
    // into whichever file happens to run next. That makes suite order a hidden
    // input and produced an intermittent failure roughly 1 run in 10.
    //
    // Resetting here rather than in `resetMocks()` is deliberate: this runs at
    // module scope, once per file, so it cannot undo a `beforeAll` sign-in the
    // way a global `afterEach` would. Every file starts signed out; nothing
    // within a file is disturbed.
    mockClerk.signOut();

    return mockClerk;
}
