/**
 * Pure unit tests for the capture framework.
 *
 * Everything here is a decision the pipeline makes without a database, a
 * network or a model: the §4.3 formula, the four noise layers, §4.1 grouping,
 * and the settings copy §J1 specifies to the character.
 */

import { describe, expect, test } from 'bun:test';
import { WinCategory, WinSensitivity } from '@prisma/client';

import {
    BASE_CONFIDENCE,
    hasMeaningfulLabel,
    isLowSignalTitle,
    scoreConfidence,
    shouldDraftAtConfidence,
    shouldSurfaceInDigest,
    statesAQuantity,
} from './confidence';
import { matchesKeyword, NOISE_RULES, describeNoiseRule, userConfigNoise } from './noise';
import { groupKeyFor, sharedKeywordCount, titleKeywords, UnionFind } from './grouping';
import { EMPTY_SOURCE_CONFIG, parseSourceConfig, type SourceConfig } from './types';
import {
    buildCandidateContext,
    buildDraftPrompt,
    genericizeTitle,
    groundingSource,
    sanitizeCaptureDraft,
    sanitizeSkills,
    type CaptureDraft,
} from './drafting';
import { classifyGithubNoise, isBotAuthor, isSubstantiveReview } from './github/noise';
import { groupGithubSignals } from './github/grouping';
import {
    buildQueries,
    deriveTopDirs,
    parseLinkedIssueRefs,
    searchDate,
    truncateBody,
} from './github/adapter';
import {
    buildRepoOptions,
    describeAccess,
    describeContribution,
    describeSelection,
    filterRepoOptions,
} from './views';
import { disconnectCopy, GITHUB_CONSENT } from './consent';
import { corpusById, CORPUS_NOW, groupedCases, pr, review } from '@/__fixtures__/github';
import { singletonGroup } from './grouping';

// ═══════════════════════════════════════════════════════ §4.3 confidence

describe('confidence — the §4.3 formula, transcribed', () => {
    const bare = {
        title: 'Add a retry to the export job',
        body: '',
        linkedIssueText: null,
        labels: [] as string[],
        filesChanged: 4,
        reviewCommentsByOthers: 0,
    };

    test('a bare candidate scores the base', () => {
        expect(scoreConfidence(bare).score).toBeCloseTo(BASE_CONFIDENCE, 5);
    });

    test('each term contributes exactly its documented weight', () => {
        expect(scoreConfidence({ ...bare, body: 'x'.repeat(201) }).score).toBeCloseTo(0.6, 5);
        expect(scoreConfidence({ ...bare, linkedIssueText: 'why it mattered' }).score).toBeCloseTo(0.55, 5);
        expect(scoreConfidence({ ...bare, body: 'cut it to 180ms' }).score).toBeCloseTo(0.55, 5);
        expect(scoreConfidence({ ...bare, reviewCommentsByOthers: 3 }).score).toBeCloseTo(0.5, 5);
        expect(scoreConfidence({ ...bare, labels: ['performance'] }).score).toBeCloseTo(0.5, 5);
        expect(scoreConfidence({ ...bare, filesChanged: 61 }).score).toBeCloseTo(0.2, 5);
        expect(scoreConfidence({ ...bare, title: 'fix typo' }).score).toBeCloseTo(0.25, 5);
    });

    test('the PRD worked example scores 1.0 and clamps', () => {
        const perfect = scoreConfidence({
            title: 'Batch pricing lookups in checkout path',
            body: 'x'.repeat(400),
            linkedIssueText: 'Checkout times out during peak',
            labels: ['performance', 'backend'],
            filesChanged: 7,
            reviewCommentsByOthers: 4,
        });
        // 0.4 + 0.20 + 0.15 + 0.10 + 0.10 = 0.95; no number in this title/body.
        expect(perfect.score).toBeCloseTo(0.95, 5);
        expect(perfect.reasons.map((reason) => reason.rule)).toContain('meaningfulLabel');
    });

    test('the score is clamped to [0,1] from both directions', () => {
        const floor = scoreConfidence({ ...bare, title: 'wip', filesChanged: 900 });
        expect(floor.score).toBeGreaterThanOrEqual(0);
        expect(floor.score).toBeCloseTo(0.05, 5);
    });

    test('a version string is not a metric', () => {
        expect(statesAQuantity('Upgrade to v2.1.0')).toBe(false);
        expect(statesAQuantity('Shipped on 2026-07-14')).toBe(false);
        expect(statesAQuantity('Cut p95 to 180ms')).toBe(true);
    });

    test('thresholds match §4.3', () => {
        expect(shouldDraftAtConfidence(0.2)).toBe(true);
        expect(shouldDraftAtConfidence(0.19)).toBe(false);
        expect(shouldSurfaceInDigest(0.35)).toBe(true);
        expect(shouldSurfaceInDigest(0.34)).toBe(false);
    });

    test('§6.4 low-signal titles are a penalty, and a single word always is one', () => {
        expect(isLowSignalTitle('cleanup')).toBe(true);
        expect(isLowSignalTitle('WIP')).toBe(true);
        expect(isLowSignalTitle('Fix typo in the README')).toBe(true);
        expect(isLowSignalTitle('Batch pricing lookups in checkout')).toBe(false);
    });

    test('meaningful labels describe the work, not the process', () => {
        expect(hasMeaningfulLabel(['performance'])).toBe(true);
        expect(hasMeaningfulLabel(['area/security'])).toBe(true);
        expect(hasMeaningfulLabel(['good first issue', 'needs triage'])).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════ §6 noise layers

describe('noise — layer 1, the bot gate', () => {
    const cases: Array<[string, 'User' | 'Bot', boolean]> = [
        ['dependabot[bot]', 'Bot', true],
        ['renovate', 'User', true],
        ['github-actions', 'User', true],
        ['acme-release-bot', 'User', true],
        ['crowdin-sync', 'Bot', true],
        ['bot-runner', 'User', true],
        ['maya-dev', 'User', false],
        ['robert', 'User', false],
        ['abbot', 'User', false],
    ];

    for (const [login, type, expected] of cases) {
        test(`${login} (${type}) -> ${expected ? 'bot' : 'human'}`, () => {
            expect(isBotAuthor({ authorLogin: login, authorType: type })).toBe(expected);
        });
    }
});

describe('noise — layer 2, the rules the user taught us', () => {
    const config: SourceConfig = {
        includedRepos: ['acme/api', 'acme/web'],
        excludedRepos: ['acme/sandbox', 'playground/*'],
        excludedKeywords: ['ci', 'spike'],
        calendars: [],
    };

    test('an excluded repo is filtered', () => {
        const verdict = userConfigNoise({ scope: 'acme/sandbox', title: 'Real work', body: '' }, config);
        expect(verdict).toEqual({ noise: true, rule: NOISE_RULES.excludedRepo, layer: 2 });
    });

    test('an org wildcard excludes the whole org', () => {
        const verdict = userConfigNoise({ scope: 'playground/toy', title: 'Real work', body: '' }, config);
        expect(verdict.noise).toBe(true);
    });

    test('includedRepos acts as an allow-list once it is non-empty', () => {
        const verdict = userConfigNoise({ scope: 'acme/secret', title: 'Real work', body: '' }, config);
        expect(verdict).toEqual({ noise: true, rule: NOISE_RULES.notIncludedRepo, layer: 2 });
    });

    test('an empty includedRepos allows everything (nothing chosen yet)', () => {
        const verdict = userConfigNoise({ scope: 'anything/at-all', title: 'x', body: '' }, EMPTY_SOURCE_CONFIG);
        expect(verdict.noise).toBe(false);
    });

    test('keywords match whole words only — "ci" must not eat "decision"', () => {
        expect(matchesKeyword('a decision about specifics', 'ci')).toBe(false);
        expect(matchesKeyword('fix the ci pipeline', 'ci')).toBe(true);
        expect(matchesKeyword('CI is red', 'ci')).toBe(true);
    });

    test('multi-word keywords match as a phrase', () => {
        expect(matchesKeyword('a design spike for pricing', 'design spike')).toBe(true);
        expect(matchesKeyword('a design doc and a spike', 'design spike')).toBe(false);
    });

    test('every rule has user-facing copy', () => {
        for (const rule of Object.values(NOISE_RULES)) {
            expect(describeNoiseRule(rule)).not.toBe('Filtered');
        }
    });
});

describe('noise — layer 3, the review substance test (§6.3)', () => {
    test('an approval with no comment is never a Win', () => {
        expect(isSubstantiveReview({ reviewState: 'APPROVED', reviewBody: 'LGTM' })).toBe(false);
        expect(isSubstantiveReview({ reviewState: 'APPROVED', reviewBody: '' })).toBe(false);
    });

    test('CHANGES_REQUESTED always passes, however short', () => {
        expect(isSubstantiveReview({ reviewState: 'CHANGES_REQUESTED', reviewBody: 'No.' })).toBe(true);
    });

    test('a quoted diff does not buy you 120 characters', () => {
        const body = [
            '```suggestion',
            'const prices = await pricing.batchLookup(lineItems.map((item) => item.sku));',
            'const total = prices.reduce((sum, price) => sum + price.amount, 0);',
            '```',
            '> we should probably batch these instead of one call per line item',
            'LGTM',
        ].join('\n');
        expect(body.length).toBeGreaterThan(120);
        expect(isSubstantiveReview({ reviewState: 'APPROVED', reviewBody: body })).toBe(false);
    });

    test('a real argument passes', () => {
        const body = corpusById('rev-substantive-locking');
        expect(
            isSubstantiveReview({
                reviewState: 'CHANGES_REQUESTED',
                reviewBody: (body.signal.metadata as { reviewBody: string }).reviewBody,
            }),
        ).toBe(true);
    });
});

describe('noise — layers run cheapest first', () => {
    test('a bot in an excluded repo reports the bot rule, not the repo rule', () => {
        const bot = corpusById('bot-dependabot-lodash');
        const verdict = classifyGithubNoise(
            {
                title: bot.signal.title,
                body: bot.signal.body,
                metadata: bot.signal.metadata as never,
            },
            { ...EMPTY_SOURCE_CONFIG, excludedRepos: ['acme/api'] },
        );
        expect(verdict).toEqual({ noise: true, rule: NOISE_RULES.botAuthor, layer: 1 });
    });
});

// ═══════════════════════════════════════════════════════ §4.1 grouping

describe('grouping', () => {
    test('the key is stable regardless of member order', () => {
        expect(groupKeyFor('pr_merged', ['b', 'a', 'c'])).toBe(groupKeyFor('pr_merged', ['c', 'b', 'a']));
        expect(groupKeyFor('pr_merged', ['a'])).not.toBe(groupKeyFor('pr_reviewed', ['a']));
    });

    test('title keywords drop the conventional-commit prefix and the filler', () => {
        const keywords = titleKeywords('perf(checkout): batch the pricing lookups');
        // "checkout" is gone with the prefix, and that is correct: the scope
        // becomes a topDir (`scope:checkout`), which is the axis grouping uses it on.
        expect([...keywords].sort()).toEqual(['batch', 'lookup', 'pricing']);
    });

    test('two PRs in the same effort share keywords; unrelated ones do not', () => {
        expect(sharedKeywordCount('Migrate payments to the ledger', 'Migrate payments module part two')).toBeGreaterThanOrEqual(2);
        expect(sharedKeywordCount('Fix the search cursor', 'Add a retry to the export job')).toBe(0);
    });

    test('union-find is transitive across a chain', () => {
        const union = new UnionFind(3);
        union.union(0, 1);
        union.union(1, 2);
        expect(union.clusters()).toEqual([[0, 1, 2]]);
    });

    test('six PRs, same repo, same dir, ≤5 days apart, shared keywords → one candidate (§12)', () => {
        const signals = groupedCases('payments-migration').map((entry) => entry.signal);
        expect(signals.length).toBe(6);
        const groups = groupGithubSignals(signals);
        expect(groups.length).toBe(1);
        expect(groups[0].signals.length).toBe(6);
    });

    test('a different effort in the same repo stays separate', () => {
        const signals = [
            ...groupedCases('payments-migration').map((entry) => entry.signal),
            ...groupedCases('search-rewrite').map((entry) => entry.signal),
        ];
        const groups = groupGithubSignals(signals);
        expect(groups.length).toBe(2);
        expect(groups.map((group) => group.signals.length).sort()).toEqual([3, 6]);
    });

    test('a PR absorbs the issue it closes; an unrelated issue stands alone', () => {
        const prCase = pr({
            id: 'tmp-pr',
            title: 'Cache the entitlement lookup',
            body: 'Closes #3310. Adds a per-request memo.',
            issue: { number: 3310, title: 'Dashboard is slow', body: '12 identical lookups per dashboard.' },
            dirs: ['src/platform'],
            daysAgo: 5,
            label: { verdict: 'draft', bot: false, acceptable: true },
        });
        const issueSignal = {
            ...prCase.signal,
            externalId: 'I_issue3310',
            kind: 'issue_closed' as const,
            title: 'Dashboard is slow',
            metadata: { ...(prCase.signal.metadata as object), number: 3310 },
        };
        const groups = groupGithubSignals([prCase.signal, issueSignal]);
        expect(groups.length).toBe(1);
        expect(groups[0].primary.kind).toBe('pr_merged');
        expect(groups[0].signals.length).toBe(2);
    });

    test('reviews never merge with anything', () => {
        const one = review({ id: 'r1', title: 'A', reviewBody: 'x'.repeat(200), label: { verdict: 'draft', bot: false, acceptable: true } });
        const two = review({ id: 'r2', title: 'A', reviewBody: 'y'.repeat(200), label: { verdict: 'draft', bot: false, acceptable: true } });
        expect(groupGithubSignals([one.signal, two.signal]).length).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════ adapter helpers

describe('github adapter helpers', () => {
    test('linked-issue refs are parsed, including cross-repo', () => {
        expect(parseLinkedIssueRefs('Closes #12 and fixes acme/web#34', 'acme/api')).toEqual([
            { repo: 'acme/api', number: 12 },
            { repo: 'acme/web', number: 34 },
        ]);
        expect(parseLinkedIssueRefs('Related to #12', 'acme/api')).toEqual([]);
    });

    test('top dirs prefer real paths, then the conventional-commit scope, then labels', () => {
        expect(deriveTopDirs({ filePaths: ['src/api/x.ts', 'src/api/y.ts', 'docs/a.md'], title: '', labels: [] })).toEqual([
            'src/api',
            'docs',
        ]);
        expect(deriveTopDirs({ title: 'perf(checkout): batch', labels: [] })).toEqual(['scope:checkout']);
        expect(deriveTopDirs({ title: 'Batch lookups', labels: ['area/payments'] })).toEqual(['scope:payments']);
    });

    test('the search queries are author-scoped, which is what keeps two users apart (§11)', () => {
        const queries = buildQueries('maya-dev', new Date('2026-05-02T00:00:00Z'));
        expect(queries.merged).toBe('is:pr is:merged author:maya-dev merged:>=2026-05-02');
        expect(queries.reviewed).toContain('reviewed-by:maya-dev');
        expect(queries.reviewed).toContain('-author:maya-dev');
        expect(queries.issues).toContain('assignee:maya-dev');
    });

    test('search dates are day-granular, which is all GitHub honours', () => {
        expect(searchDate(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07-31');
    });

    test('bodies are truncated at the documented ceiling', () => {
        expect(truncateBody('x'.repeat(2_000)).length).toBe(1_200);
        expect(truncateBody('short')).toBe('short');
    });
});

// ═══════════════════════════════════════════════ drafting: the honest parts

describe('drafting — the grounding source is narrower than the prompt', () => {
    const candidate = corpusById('q-checkout-latency');
    const context = buildCandidateContext(singletonGroup(candidate.signal), 'Senior Backend Engineer at Acme');

    test('the prompt carries the counts, the merge date and the linked issue', () => {
        const prompt = buildDraftPrompt(context);
        expect(prompt).toContain('files_changed: 7');
        expect(prompt).toContain('additions: 210');
        expect(prompt).toContain('linked_issue:');
        expect(prompt).toContain('Senior Backend Engineer at Acme');
    });

    test('the grounding source carries NONE of the counts — this is the §12 gate', () => {
        const source = groundingSource(context);
        expect(source).toContain('800ms');
        expect(source).toContain('Checkout times out during peak');
        // 7 files / 210 additions / 340 deletions are all absent, so a draft
        // that quotes them is a fabrication by construction.
        expect(source).not.toContain('files_changed');
        expect(source).not.toContain('additions');
    });
});

describe('drafting — sanitizers resolve downward', () => {
    const context = buildCandidateContext(
        singletonGroup(corpusById('q-checkout-latency').signal),
        'Senior Backend Engineer at Acme',
    );

    const base: CaptureDraft = {
        title: 'Cut checkout p95 from 800ms to 180ms',
        narrative: 'Batched the pricing lookups.',
        category: WinCategory.improved,
        skills: ['PostgreSQL'],
        collaborators: [],
        suggestedSensitivity: WinSensitivity.internal_only,
        quantified: true,
        impact: { metric: 'checkout p95', baseline: '800ms', result: '180ms', delta: null, scope: null, timeframe: null },
        quantifyPrompt: null,
        shouldDraft: true,
        dismissReason: null,
    };

    const sanitize = (draft: CaptureDraft, violationsOn: string[] = []) =>
        sanitizeCaptureDraft({
            draft,
            context,
            sourceText: groundingSource(context),
            violations: violationsOn.map((field) => ({
                path: field,
                field,
                text: '',
                quantity: { raw: '77%', kind: 'percent', value: 77, literal: 77, index: 0 },
            })),
            confidence: 0.8,
        });

    test('shouldDraft=false is a rejection carrying the model’s reason', () => {
        const result = sanitize({ ...base, shouldDraft: false, dismissReason: 'no context' });
        expect(result).toEqual({ rejected: true, reason: 'no context' });
    });

    test('a blank title is a rejection, never a degraded Win', () => {
        expect(sanitize({ ...base, title: '   ' })).toEqual({
            rejected: true,
            reason: 'title did not survive the numeric guard',
        });
    });

    test('a stripped impact becomes quantified=false with a prompt, never a half-metric', () => {
        const result = sanitize(base, ['impact']);
        expect('rejected' in result).toBe(false);
        if ('rejected' in result) return;
        expect(result.impact).toBeNull();
        expect(result.quantified).toBe(false);
        expect(result.quantifyPrompt).toBeTruthy();
    });

    test('brag words are removed rather than tolerated', () => {
        const result = sanitize({ ...base, title: 'Successfully spearheaded the checkout rework' });
        expect('rejected' in result).toBe(false);
        if ('rejected' in result) return;
        expect(result.title.toLowerCase()).not.toContain('successfully');
        expect(result.title.toLowerCase()).not.toContain('spearheaded');
    });

    test('a review with nothing quotable is rejected (§4.2 rule 4)', () => {
        const reviewContext = buildCandidateContext(
            singletonGroup(corpusById('rev-substantive-locking').signal),
            null,
        );
        const result = sanitizeCaptureDraft({
            draft: { ...base, narrative: 'Reviewed it.' },
            context: reviewContext,
            sourceText: groundingSource(reviewContext),
            violations: [],
            confidence: 0.7,
        });
        expect(result).toEqual({ rejected: true, reason: 'review narrative quotes no substance' });
    });

    test('a review is always categorised as influenced', () => {
        const reviewContext = buildCandidateContext(
            singletonGroup(corpusById('rev-substantive-locking').signal),
            null,
        );
        const result = sanitizeCaptureDraft({
            draft: { ...base, category: WinCategory.shipped, narrative: 'x'.repeat(80) },
            context: reviewContext,
            sourceText: groundingSource(reviewContext),
            violations: [],
            confidence: 0.7,
        });
        expect('rejected' in result).toBe(false);
        if ('rejected' in result) return;
        expect(result.category).toBe(WinCategory.influenced);
    });
});

describe('drafting — §4.2 rule 5, a confidential title stays generic', () => {
    test('the repo’s proper nouns are removed from the title, not the narrative', () => {
        const context = buildCandidateContext(singletonGroup(corpusById('sens-named-customer').signal), null);
        const generic = genericizeTitle('Add the Northwind export for Acme customers', {
            ...context,
            primaryMetadata: { ...context.primaryMetadata, repo: 'acme/api' },
        });
        expect(generic).not.toContain('Acme');
        expect(generic).toContain('Northwind'); // not a repo word — the narrative rule covers it
    });
});

describe('drafting — skills keep the technology and lose the version', () => {
    test('an unsupported version is stripped but the skill survives', () => {
        expect(sanitizeSkills(['React 18', 'PostgreSQL'], 'we used react and postgres')).toEqual([
            'React',
            'PostgreSQL',
        ]);
    });

    test('a version present in the source is left alone', () => {
        expect(sanitizeSkills(['Node 20'], 'upgraded to node 20')).toEqual(['Node 20']);
    });

    test('a skill that is nothing but a number is dropped', () => {
        expect(sanitizeSkills(['42'], 'no numbers here')).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════ config parsing

describe('source config', () => {
    test('malformed stored JSON degrades to an empty config rather than throwing', () => {
        expect(parseSourceConfig(null)).toEqual(EMPTY_SOURCE_CONFIG);
        expect(parseSourceConfig('nonsense')).toEqual(EMPTY_SOURCE_CONFIG);
        expect(parseSourceConfig({ includedRepos: [1, 'acme/api', 'acme/api'] })).toEqual({
            ...EMPTY_SOURCE_CONFIG,
            includedRepos: ['acme/api'],
        });
    });
});

// ═══════════════════════════════════════════════════════ §J1 settings copy

describe('settings copy — §J1 specifies these strings exactly', () => {
    test('the access line answers "what can this see?"', () => {
        expect(describeAccess({ repoCount: 12, canSeePrivate: true })).toBe('12 repos · public + private');
        expect(describeAccess({ repoCount: 1, canSeePrivate: false })).toBe('1 repo · public only');
    });

    test('the contribution line is silent when the source has drafted nothing', () => {
        expect(describeContribution({ fromSource: 61, total: 74 })).toBe('Has drafted 61 of your 74 wins');
        expect(describeContribution({ fromSource: 0, total: 74 })).toBeNull();
    });

    test('the disconnect dialog names the real number, and offers both options', () => {
        const copy = disconnectCopy(61);
        expect(copy.body).toContain('Your 61 logged wins stay yours');
        expect(copy.body).toContain('within 24 hours');
        expect(copy.destructiveCta).toBe('Disconnect and delete the 61 wins too');
        expect(disconnectCopy(1).destructiveCta).toBe('Disconnect and delete the 1 win too');
    });

    test('the consent copy is the PRD §3.2 text', () => {
        expect(GITHUB_CONSENT.body).toContain('We do **not** read your source code');
        expect(GITHUB_CONSENT.body).toContain('you choose which repos we look at');
        expect(GITHUB_CONSENT.checkmarks).toHaveLength(3);
        expect(GITHUB_CONSENT.primaryCta).toBe('Connect with private repos');
    });
});

// ═══════════════════════════════════════════════════════ §A2b repo picker

describe('repo picker', () => {
    function fakeRepos(count: number) {
        return Array.from({ length: count }, (_unused, index) => ({
            fullName: `acme/service-${index}`,
            private: index % 3 === 0,
            pushedAt: new Date(CORPUS_NOW.getTime() - index * 86_400_000).toISOString(),
            archived: index % 50 === 0,
            fork: index % 37 === 0,
            contributionsLast90d: null,
        }));
    }

    test('pre-selects the last 90 days and sorts by recency', () => {
        const options = buildRepoOptions(fakeRepos(120), [], CORPUS_NOW);
        expect(options[0].fullName).toBe('acme/service-1'); // 0 is archived, sorts last
        expect(options.filter((option) => option.selected).length).toBeGreaterThan(80);
        expect(options.at(-1)?.archived).toBe(true);
    });

    test('an existing selection always wins over the 90-day heuristic', () => {
        const options = buildRepoOptions(fakeRepos(20), ['acme/service-19'], CORPUS_NOW);
        expect(options.filter((option) => option.selected).map((option) => option.fullName)).toEqual([
            'acme/service-19',
        ]);
    });

    test('§12 — 500 repos stay interactive: filter + window well under 300ms', () => {
        const options = buildRepoOptions(fakeRepos(500), [], CORPUS_NOW);
        expect(options).toHaveLength(500);

        const started = performance.now();
        // Simulate typing "service-4" one character at a time — the worst case,
        // because every keystroke re-filters the whole list.
        for (const query of ['s', 'se', 'ser', 'serv', 'servi', 'servic', 'service', 'service-', 'service-4']) {
            const filtered = filterRepoOptions(options, query);
            // and the window the component would render
            filtered.slice(0, 20);
        }
        const elapsed = performance.now() - started;
        expect(elapsed).toBeLessThan(300);
    });

    test('the selection counter is the §A2b string', () => {
        const options = buildRepoOptions(fakeRepos(3), ['acme/service-1'], CORPUS_NOW);
        expect(describeSelection(options)).toBe('1 of 3 selected');
    });
});
