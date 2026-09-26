/**
 * One real Scout run, end to end, against the LOCAL database.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/resume_builder \
 *   DIRECT_URL=$DATABASE_URL \
 *   bun scripts/scout-smoke.ts <userId> <url-or-text> [--fresh]
 *
 * Real fetches, real model calls (a fraction of a cent on gpt-6-luna), and
 * real search if TAVILY_API_KEY is set. Bypasses metering and the workflow
 * runtime — it drives the same `runScoutStages` the workflow does, inline —
 * and prints the step timeline and every section's outcome. `--fresh` deletes
 * a previous run for the same input first.
 */

import { createOrGetRun, loadRun, readSections } from '@/lib/agent/run';
import { prisma } from '@/lib/prisma';
import { scoutInputKey } from '@/lib/scout/inputKey';
import { parseSharedMessage } from '@/lib/scout/message';
import { INLINE_DRIVER } from '@/lib/scout/pipeline';
import { runScoutStages } from '@/lib/scout/stages';
import { SCOUT_AGENT } from '@/lib/scout/types';

async function main() {
    const [userId, raw, flag] = process.argv.slice(2);
    if (!userId || !raw) {
        console.error('usage: bun scripts/scout-smoke.ts <userId> <url-or-text> [--fresh]');
        process.exit(2);
    }
    if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
        console.error('Refusing to run: DATABASE_URL is not the local database.');
        process.exit(2);
    }

    const shared = parseSharedMessage(raw);
    const input = { url: shared.url, text: shared.text, source: 'dashboard' as const };
    const inputKey = scoutInputKey(input);
    if (flag === '--fresh') {
        await prisma.agentRun.deleteMany({ where: { userId, inputKey } });
    }

    const { run } = await createOrGetRun({ userId, agent: SCOUT_AGENT, inputKey, input });
    console.log(`run ${run.id}  key ${inputKey}`);
    const started = Date.now();
    await runScoutStages(run.id, INLINE_DRIVER);
    const done = await loadRun(run.id);
    if (!done) throw new Error('run vanished');

    const steps = await prisma.agentStep.findMany({ where: { runId: run.id }, orderBy: { startedAt: 'asc' } });
    console.log(`\nstatus ${done.status}  kind ${done.kind}  ${((Date.now() - started) / 1000).toFixed(1)}s  $${done.costUsd.toFixed(5)}`);
    if (done.error) console.log(`error: ${done.error}`);
    console.log('\nsteps');
    for (const step of steps) {
        const sources = Array.isArray(step.sources) ? step.sources.length : 0;
        console.log(
            `  ${step.name.padEnd(11)} #${step.attempt} ${step.status.padEnd(11)} ${String(step.latencyMs ?? '-').padStart(6)}ms  $${step.costUsd.toFixed(5)}  src=${sources}${step.reason ? `  — ${step.reason}` : ''}`,
        );
    }
    console.log('\nsections');
    console.log(JSON.stringify(readSections(done), null, 2).slice(0, 12_000));
    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
});
