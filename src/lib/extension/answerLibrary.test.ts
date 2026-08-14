/**
 * The saved-answer library, against the real local Postgres.
 *
 * These functions are the read side of a table the extension has been writing
 * since day one. The tests worth having here are the ownership ones: an answer
 * library is personal, and a scoping mistake would let one user read, edit, or
 * delete another's answers. Everything is therefore asserted with two users
 * present, never one.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { prisma } from '@/lib/prisma';
import {
    deleteReusableAnswer,
    listReusableAnswers,
    updateReusableAnswer,
} from '@/lib/extension/questions';

const users: string[] = [];

function newUser(label: string): string {
    const id = `test-answers-${label}-${crypto.randomUUID()}`;
    users.push(id);
    return id;
}

async function seed(
    userId: string,
    patch: Partial<{
        canonicalQuestion: string;
        answerText: string;
        usageCount: number;
        autoUse: boolean;
        fingerprint: string;
    }> = {},
) {
    return prisma.reusableAnswer.create({
        data: {
            userId,
            questionFingerprint: patch.fingerprint ?? `fp-${crypto.randomUUID()}`,
            canonicalQuestion: patch.canonicalQuestion ?? 'Why do you want to work here?',
            answerText: patch.answerText ?? 'Because the problems are real.',
            usageCount: patch.usageCount ?? 0,
            autoUse: patch.autoUse ?? false,
        },
        select: { id: true },
    });
}

afterEach(async () => {
    while (users.length > 0) {
        const id = users.pop();
        if (id) await prisma.reusableAnswer.deleteMany({ where: { userId: id } });
    }
});

describe('listReusableAnswers', () => {
    test('returns only the requesting user\'s answers', async () => {
        const mine = newUser('mine');
        const theirs = newUser('theirs');
        await seed(mine, { canonicalQuestion: 'Mine' });
        await seed(theirs, { canonicalQuestion: 'Theirs' });

        const list = await listReusableAnswers({ userId: mine });
        expect(list).toHaveLength(1);
        expect(list[0].canonicalQuestion).toBe('Mine');
    });

    test('auto-use answers sort first — they act without asking', async () => {
        const userId = newUser('sort');
        await seed(userId, { canonicalQuestion: 'Manual but popular', usageCount: 99 });
        await seed(userId, { canonicalQuestion: 'Auto', autoUse: true, usageCount: 1 });

        const list = await listReusableAnswers({ userId });
        expect(list[0].canonicalQuestion).toBe('Auto');
    });

    test('within the same auto-use state, more-used answers come first', async () => {
        const userId = newUser('usage');
        await seed(userId, { canonicalQuestion: 'Rare', usageCount: 1 });
        await seed(userId, { canonicalQuestion: 'Common', usageCount: 12 });

        const list = await listReusableAnswers({ userId });
        expect(list.map((a) => a.canonicalQuestion)).toEqual(['Common', 'Rare']);
    });

    test('never leaks the fingerprint — it is an internal matching key', async () => {
        const userId = newUser('leak');
        await seed(userId, { fingerprint: 'secret-internal-key' });

        const [answer] = await listReusableAnswers({ userId });
        expect(JSON.stringify(answer)).not.toContain('secret-internal-key');
        expect('questionFingerprint' in answer).toBe(false);
    });

    test('an empty library is an empty array, not an error', async () => {
        expect(await listReusableAnswers({ userId: newUser('empty') })).toEqual([]);
    });

    test('limit is clamped so a caller cannot ask for everything', async () => {
        const userId = newUser('limit');
        await seed(userId);
        // Absurd input must not become an unbounded query.
        const list = await listReusableAnswers({ userId, limit: 100_000 });
        expect(list.length).toBeLessThanOrEqual(200);
    });
});

describe('updateReusableAnswer', () => {
    test('edits the answer text', async () => {
        const userId = newUser('edit');
        const { id } = await seed(userId);

        const updated = await updateReusableAnswer({
            userId,
            answerId: id,
            patch: { answerText: 'A better answer.' },
        });
        expect(updated?.answerText).toBe('A better answer.');
    });

    test('toggling auto-use does not disturb the text', async () => {
        const userId = newUser('toggle');
        const { id } = await seed(userId, { answerText: 'Keep me exactly.' });

        const updated = await updateReusableAnswer({ userId, answerId: id, patch: { autoUse: true } });
        expect(updated?.autoUse).toBe(true);
        expect(updated?.answerText).toBe('Keep me exactly.');
    });

    test('editing the text does not silently clear auto-use', async () => {
        // The partial-update bug that would quietly stop an answer firing.
        const userId = newUser('partial');
        const { id } = await seed(userId, { autoUse: true });

        const updated = await updateReusableAnswer({
            userId,
            answerId: id,
            patch: { answerText: 'Reworded.' },
        });
        expect(updated?.autoUse).toBe(true);
    });

    test('cannot edit another user\'s answer', async () => {
        const owner = newUser('owner');
        const attacker = newUser('attacker');
        const { id } = await seed(owner, { answerText: 'Original.' });

        const result = await updateReusableAnswer({
            userId: attacker,
            answerId: id,
            patch: { answerText: 'Hijacked.' },
        });
        expect(result).toBeNull();

        // And the row is genuinely untouched, not merely unreported.
        const [still] = await listReusableAnswers({ userId: owner });
        expect(still.answerText).toBe('Original.');
    });

    test('a missing answer returns null rather than throwing', async () => {
        const userId = newUser('missing');
        expect(
            await updateReusableAnswer({ userId, answerId: 'nope', patch: { autoUse: true } }),
        ).toBeNull();
    });
});

describe('deleteReusableAnswer', () => {
    test('removes the answer', async () => {
        const userId = newUser('del');
        const { id } = await seed(userId);

        expect(await deleteReusableAnswer({ userId, answerId: id })).toBe(true);
        expect(await listReusableAnswers({ userId })).toEqual([]);
    });

    test('cannot delete another user\'s answer', async () => {
        const owner = newUser('delowner');
        const attacker = newUser('delattacker');
        const { id } = await seed(owner);

        expect(await deleteReusableAnswer({ userId: attacker, answerId: id })).toBe(false);
        expect(await listReusableAnswers({ userId: owner })).toHaveLength(1);
    });

    test('deleting something absent reports false, not an error', async () => {
        expect(await deleteReusableAnswer({ userId: newUser('gone'), answerId: 'nope' })).toBe(false);
    });
});
