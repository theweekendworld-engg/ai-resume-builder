/**
 * First run, against the live Postgres.
 *
 * The value of onboarding is entirely in whether history actually lands in the
 * database, so the assertions are about rows rather than screens. The model
 * that reads the resume is the injected seam; everything else is real.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';

import { installClerkMock } from '@/__mocks__/clerk';
import { installMocks, mocks, resetMocks, uninstallMocks } from '@/__mocks__';
import { prisma } from '@/lib/prisma';
import { invalidateFlagCache } from '@/lib/flags';
import { restoreFlags, snapshotFlags, type FlagSnapshot } from '@/lib/flags.test-utils';

/** Restored in `afterAll` — the suite shares a database with development. */
let __flagSnapshot: FlagSnapshot = [];

const clerk = installClerkMock();

/**
 * `next/cache` is not stubbed here, and these tests do not assert anything
 * about it.
 *
 * Writing them surfaced a real defect: `updateTag` throws outside a Server
 * Action scope, and `completeOnboarding` wrapped the write and the
 * invalidation in one try — so onboarding reported "could not finish setup"
 * after `onboardingComplete` was already true, stranding the user on a screen
 * that would have redirected past itself. That is fixed in profile.ts.
 *
 * The fix is deliberately NOT asserted here. `mock.module` is process-global,
 * and `digest.integration.test.ts` loads earlier in the same run and stubs
 * `updateTag` to a no-op — so a test of the throwing path would mean one thing
 * alone and nothing in a full run. An assertion whose meaning depends on file
 * order is worse than none.
 */
const onboarding = await import('@/actions/onboarding');

const RUN = `itest-onb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const users: string[] = [];

function signIn(label: string): string {
    const id = `${RUN}-${label}`;
    users.push(id);
    clerk.signIn(id);
    return id;
}

/** Extracted PDF text, as `/score` hands it over. */
const RESUME_TEXT = `PRIYA RAMAN
Senior Software Engineer
priya@example.com | San Francisco, CA

EXPERIENCE

Flexport — Senior Software Engineer, 2021 - Present
• Cut invoice generation p95 from 4.2s to 900ms with a batched query.
• Led the migration of 9 services from EC2 to Kubernetes.

Instacart — Software Engineer, 2018 - 2021
• Built the order settlement pipeline processing 1.2M orders per day.

EDUCATION
BSc Computer Science, University of Bristol, 2018
`;

/** What the parse model returns for the text above. */
function parsedResume() {
    return {
        personalInfo: {
            fullName: 'Priya Raman',
            email: 'priya@example.com',
            phone: '',
            location: 'San Francisco, CA',
            linkedin: '',
            github: '',
            website: '',
            summary: '',
            title: 'Senior Software Engineer',
        },
        experiences: [
            {
                company: 'Flexport',
                role: 'Senior Software Engineer',
                startDate: '2021-03',
                endDate: '',
                current: true,
                location: 'San Francisco, CA',
                description: 'Cut invoice generation p95 from 4.2s to 900ms with a batched query.',
                highlights: ['Led the migration of 9 services from EC2 to Kubernetes.'],
            },
            {
                company: 'Instacart',
                role: 'Software Engineer',
                startDate: '2018-06',
                endDate: '2021-02',
                current: false,
                location: 'San Francisco, CA',
                description: 'Built the order settlement pipeline processing 1.2M orders per day.',
                highlights: [],
            },
        ],
        education: [
            {
                institution: 'University of Bristol',
                degree: 'BSc',
                fieldOfStudy: 'Computer Science',
                startDate: '2015-09',
                endDate: '2018-06',
                current: false,
            },
        ],
        projects: [],
        achievements: [],
        skills: ['Kubernetes'],
    };
}

/** `parseResumeText` goes through `trackedChatCompletion`, not generateStructured. */
function scriptParse(response: unknown = parsedResume()) {
    mocks().openai.onChat(/./, JSON.stringify(response));
}

async function setMissionsFlag(enabled: boolean) {
    await prisma.featureFlag.upsert({
        where: { key: 'missions' },
        create: { key: 'missions', enabled, description: 'test', rolloutPercent: 100 },
        update: { enabled, rolloutPercent: 100 },
    });
    invalidateFlagCache();
}

beforeAll(async () => {
    __flagSnapshot = await snapshotFlags();
    installMocks({ only: ['openai'] });
    await setMissionsFlag(false);
});

afterEach(() => resetMocks());

afterAll(async () => {
    await restoreFlags(__flagSnapshot);
    for (const userId of users) {
        await prisma.userExperience.deleteMany({ where: { userId } });
        await prisma.userEducation.deleteMany({ where: { userId } });
        await prisma.userProject.deleteMany({ where: { userId } });
        await prisma.knowledgeItem.deleteMany({ where: { userId } });
        await prisma.userProfile.deleteMany({ where: { userId } });
        await prisma.funnelEvent.deleteMany({ where: { userId } });
        await prisma.apiUsageLog.deleteMany({ where: { userId } });
        await prisma.mission.deleteMany({ where: { userId } });
    }
    invalidateFlagCache();
    uninstallMocks();
    clerk.signOut();
});

describe('the /score handoff finally lands', () => {
    test('text from the free checker becomes real history', async () => {
        // The whole point. Their resume was read a minute ago; nothing should
        // need uploading or typing again.
        const userId = signIn('handoff');
        scriptParse();

        const result = await onboarding.importResumeText(RESUME_TEXT);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);

        expect(result.data.experiences).toBe(2);
        expect(result.data.companies).toEqual(['Flexport', 'Instacart']);

        // Rows, not a summary object.
        const rows = await prisma.userExperience.findMany({ where: { userId } });
        expect(rows.map((r) => r.company).sort()).toEqual(['Flexport', 'Instacart']);
    });

    test('the profile is populated too, so generation has a name to put on it', async () => {
        const userId = signIn('profile');
        scriptParse();
        await onboarding.importResumeText(RESUME_TEXT);

        const profile = await prisma.userProfile.findUnique({ where: { userId } });
        expect(profile?.fullName).toBe('Priya Raman');
        expect(profile?.defaultTitle).toBe('Senior Software Engineer');
    });

    test('education comes across as well', async () => {
        const userId = signIn('education');
        scriptParse();
        await onboarding.importResumeText(RESUME_TEXT);
        expect(await prisma.userEducation.count({ where: { userId } })).toBe(1);
    });

    test('a blank or trivial handoff is refused before a model call', async () => {
        signIn('empty');
        scriptParse();
        const result = await onboarding.importResumeText('   ');
        expect(result.success).toBe(false);
        if (result.success) throw new Error('unreachable');
        expect(result.code).toBe('invalid_input');
    });

    test('a parse failure is reported, not swallowed into an empty profile', async () => {
        const userId = signIn('parse-fail');
        mocks().openai.onChat(/./, 'not json at all');

        const result = await onboarding.importResumeText(RESUME_TEXT);
        expect(result.success).toBe(false);
        // Nothing half-written.
        expect(await prisma.userExperience.count({ where: { userId } })).toBe(0);
    });
});

describe('the welcome state decides what to ask', () => {
    test('a fresh user is asked for history', async () => {
        signIn('fresh');
        const result = await onboarding.getWelcomeState();
        if (!result.success) throw new Error(result.error);
        expect(result.data.done).toBe(false);
        expect(result.data.hasHistory).toBe(false);
    });

    test('someone who already has roles is not asked again', async () => {
        const userId = signIn('has-history');
        await prisma.userExperience.create({
            data: {
                userId,
                company: 'Flexport',
                role: 'Engineer',
                startDate: '2021-01',
                highlights: [],
            },
        });
        const result = await onboarding.getWelcomeState();
        if (!result.success) throw new Error(result.error);
        expect(result.data.hasHistory).toBe(true);
    });

    test('the mission question is skipped when the flag is off', async () => {
        // Onboarding itself is never flag-gated — a user who signs up during a
        // dark rollout must still get a first run — but what it OFFERS adapts.
        signIn('flag-off');
        const result = await onboarding.getWelcomeState();
        if (!result.success) throw new Error(result.error);
        expect(result.data.missionsEnabled).toBe(false);
    });

    test('a returning user is marked done so the screen lets them through', async () => {
        const userId = signIn('returning');
        await prisma.userProfile.create({ data: { userId, onboardingComplete: true } });
        const result = await onboarding.getWelcomeState();
        if (!result.success) throw new Error(result.error);
        expect(result.data.done).toBe(true);
    });
});

describe('where it sends people', () => {
    test('no history goes to the builder, which is where history gets added', async () => {
        signIn('exit-empty');
        const result = await onboarding.finishOnboarding();
        if (!result.success) throw new Error(result.error);
        expect(result.data.next).toBe('/build');
    });

    test('history but no missions also goes to the builder', async () => {
        // Landing someone on an empty Home is how a good first run still fails.
        const userId = signIn('exit-history');
        await prisma.userExperience.create({
            data: { userId, company: 'Flexport', role: 'Engineer', startDate: '2021-01', highlights: [] },
        });
        const result = await onboarding.finishOnboarding();
        if (!result.success) throw new Error(result.error);
        expect(result.data.next).toBe('/build');
    });

    test('history plus missions goes to Home, where the mission they picked lives', async () => {
        // The one destination with something on it. Sending this user to the
        // builder instead would hide the mission they chose thirty seconds ago.
        const userId = signIn('exit-home');
        await prisma.userExperience.create({
            data: { userId, company: 'Flexport', role: 'Engineer', startDate: '2021-01', highlights: [] },
        });
        await setMissionsFlag(true);
        try {
            const result = await onboarding.finishOnboarding();
            if (!result.success) throw new Error(result.error);
            expect(result.data.next).toBe('/home');
        } finally {
            await setMissionsFlag(false);
        }
    });

    test('finishing marks it complete, so it runs exactly once', async () => {
        const userId = signIn('once');
        await onboarding.finishOnboarding();
        const profile = await prisma.userProfile.findUnique({ where: { userId } });
        expect(profile?.onboardingComplete).toBe(true);

        const state = await onboarding.getWelcomeState();
        if (!state.success) throw new Error(state.error);
        expect(state.data.done).toBe(true);
    });

    test('skipping still finishes — a wall on the first screen loses the user', async () => {
        const userId = signIn('skip');
        const result = await onboarding.skipOnboarding();
        expect(result.success).toBe(true);
        const profile = await prisma.userProfile.findUnique({ where: { userId } });
        expect(profile?.onboardingComplete).toBe(true);
    });

    test('a skip is recorded, because it is a real signal', async () => {
        const userId = signIn('skip-tracked');
        await onboarding.skipOnboarding();
        const events = await prisma.funnelEvent.findMany({
            where: { userId, type: 'onboarding_skipped' },
        });
        expect(events).toHaveLength(1);
    });
});
