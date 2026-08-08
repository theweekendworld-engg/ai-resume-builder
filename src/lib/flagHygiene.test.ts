/**
 * The suite must give the flag table back exactly as it found it.
 *
 * ── The failure this catches ────────────────────────────────────────────────
 *
 * Turn every feature on for development, run `bun test`, and some are off
 * again — `missions` left disabled by one file, `github_capture` and
 * `weekly_digest` deleted outright by another's "remove the row if it did not
 * exist before" cleanup. Nothing failed. The table was simply different
 * afterwards, and the next person to wonder why a feature vanished had no
 * thread to pull.
 *
 * This is a linter, not a unit test: it reads every test file and requires
 * that anything writing `prisma.featureFlag` also restores what it took. The
 * mechanism is `src/lib/flags.test-utils.ts`; the exemption list below is for
 * files that hand-roll an equivalent save/restore, and each entry has to say
 * where.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');

/** Files with a hand-rolled save/restore that predates the shared helper. */
const HAND_ROLLED: Record<string, string> = {
    'actions/backfill.test.ts':
        'saves and restores enabled, rolloutPercent and allowUserIds around the whole file',
};

/** A write that cannot leak, because it only ever reads back what it set. */
const WRITE = /prisma\.featureFlag\.(upsert|update|updateMany|create|delete|deleteMany)/;
const RESTORES = /restoreFlags|originalAllowList|originalEnabled|flagExisted/;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.test\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

const offenders = walk(SRC)
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => WRITE.test(source))
    .filter(({ source }) => !RESTORES.test(source))
    .map(({ file }) => file.slice(SRC.length + 1))
    .filter((rel) => !HAND_ROLLED[rel]);

describe('tests borrow the flag table, they do not keep it', () => {
    test('every file that writes a flag also restores it', () => {
        expect(
            offenders,
            `${offenders.length} test file(s) write FeatureFlag without restoring:\n  ` +
                `${offenders.join('\n  ')}\n\n` +
                'Use snapshotFlags/restoreFlags from src/lib/flags.test-utils.ts. ' +
                'The suite runs against the database a human develops on, and a flag ' +
                'left off is a feature that silently vanishes from their machine.',
        ).toEqual([]);
    });

    test('the exemption list names only files that still exist', () => {
        const all = new Set(walk(SRC).map((file) => file.slice(SRC.length + 1)));
        const stale = Object.keys(HAND_ROLLED).filter((rel) => !all.has(rel));
        expect(stale, `stale exemptions: ${stale.join(', ')}`).toEqual([]);
    });
});
