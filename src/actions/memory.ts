'use server';

/**
 * Settings → Memory (docs/impl/08-memory.md §6): list, edit, delete what
 * Patronus remembers the user told it.
 *
 * Convention order: Clerk `auth()` → zod → service → `FunnelEvent` →
 * `Result`. Not metered and not flag-gated: these are the user's own lines,
 * no model runs, and a privacy control must always be reachable.
 */

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { err, ok, type Result } from '@/lib/result';
import { track } from '@/lib/track';
import { MEMORY_TEXT_MAX } from '@/lib/memory/format';
import {
    MEMORY_SENSITIVITIES,
    editMemory,
    forgetMemory,
    listMemories,
    type MemoryView,
} from '@/services/memory';

const IdSchema = z.string().trim().min(1).max(64);

const EditSchema = z.object({
    id: IdSchema,
    text: z.string().trim().min(1, 'A memory needs some text. Delete it instead.').max(MEMORY_TEXT_MAX).optional(),
    sensitivity: z.enum(MEMORY_SENSITIVITIES).optional(),
}).refine((value) => value.text !== undefined || value.sensitivity !== undefined, {
    message: 'Nothing to change',
    path: ['text'],
});

const ForgetSchema = z.object({ id: IdSchema });

function invalidInput(error: z.ZodError): string {
    return error.issues.map((issue) => issue.message).join('; ');
}

async function signedIn(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
}

export async function listMyMemories(): Promise<Result<MemoryView[]>> {
    const userId = await signedIn();
    if (!userId) return err('Not signed in', 'unauthenticated');
    return ok(await listMemories(userId));
}

export async function updateMemory(input: unknown): Promise<Result<MemoryView>> {
    const userId = await signedIn();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const parsed = EditSchema.safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const result = await editMemory(userId, parsed.data.id, {
        text: parsed.data.text,
        sensitivity: parsed.data.sensitivity,
    });
    if (result.success) {
        await track(userId, 'memory_edited', {
            key: result.data.key,
            text: parsed.data.text !== undefined,
            sensitivity: parsed.data.sensitivity ?? null,
        });
    }
    return result;
}

export async function deleteMemory(input: unknown): Promise<Result<{ id: string }>> {
    const userId = await signedIn();
    if (!userId) return err('Not signed in', 'unauthenticated');
    const parsed = ForgetSchema.safeParse(input ?? {});
    if (!parsed.success) return err(invalidInput(parsed.error), 'invalid_input');

    const result = await forgetMemory(userId, parsed.data.id);
    if (result.success) await track(userId, 'memory_forgotten', {});
    return result;
}
