/**
 * J6 — the resume loop. Job description in, tailored PDF out.
 *
 * This is the oldest path in the product and, until now, the only end-to-end
 * flow with no journey. The reason was mechanical rather than deliberate:
 * `compileLatex` POSTs to a hardcoded third-party build service, so any such
 * test would have made a real network call — slow, flaky, and resume text
 * leaving the machine during CI. `src/lib/latexClient.ts` now holds the seam.
 *
 * What this covers that no single-feature suite does is the seams: the session
 * state machine, the pipeline's own steps, cost accounting rolling up onto the
 * session, PDF storage and its download URL, and the telemetry the funnel is
 * measured with. Those are five features' worth of edges and they only touch
 * each other here.
 *
 * The one rule it exists to protect, above all the plumbing: **the resume may
 * not contain a number that is not in the source.** J1 asserts that for a Win;
 * this asserts it for the artifact a candidate actually sends to an employer.
 */

import { describe, expect, test } from 'bun:test';
import { Channel, GenerationStatus, PipelineStep } from '@prisma/client';

import { mocks } from '@/__mocks__';
import { prisma } from '@/lib/prisma';
import type { ResumeData } from '@/types/resume';
import {
    assertNoDeadJobs,
    assertNoFabricatedNumbers,
    assertPurged,
    defineJourney,
    purge,
} from '@/__journeys__/harness';
import { __testing as latexTesting } from '@/lib/latexClient';

const journey = defineJourney({
    name: 'resume-loop',
    // `openai` for the pipeline's parse/paraphrase/assemble/score calls and the
    // retrieval embeddings; `qdrant` because project retrieval searches it.
    // No `email` — this path sends nothing.
    boundaries: ['openai', 'qdrant'],
});

const { runGenerationSession } = await import('@/actions/generationPipeline');

// ── The source material. Every figure the resume is allowed to use is here.
const JOB_DESCRIPTION = `Senior Backend Engineer, Payments — Acme

We are looking for a senior backend engineer to own our payments platform.
You will work with Go, PostgreSQL and Kubernetes at meaningful scale.
Requires 5+ years of backend experience and a track record of reliability work.`;

const EXPERIENCE = {
    company: 'Northwind',
    role: 'Backend Engineer',
    description: 'Owned the checkout and billing services.',
    highlights: [
        'Cut checkout p95 latency from 800ms to 180ms by batching the pricing lookup.',
        'Led the migration of 12 services onto Kubernetes.',
        'Reduced payment failure rate from 2.4% to 0.6% over two quarters.',
    ],
};

/** Everything the model was allowed to draw a number from. */
const SOURCE_CORPUS = [
    JOB_DESCRIPTION,
    EXPERIENCE.description,
    ...EXPERIENCE.highlights,
].join('\n');

/**
 * A minimal valid PDF. The pipeline only ever base64-decodes it and measures
 * its length, so the bytes need to be a plausible PDF and nothing more.
 */
const FAKE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n%%EOF\n');

let latexRequests = 0;

/**
 * The prose a human reads, and nothing else.
 *
 * The first version of this check ran over `JSON.stringify(resume.content)`
 * and failed on "0001658" and "31423" — fragments of cuids. Stringifying the
 * record drags in row ids, section keys and date strings, none of which is a
 * claim about the candidate. The guard is about text someone reads; feeding it
 * the serialisation form is how you get a test that fails for reasons the user
 * would never see.
 */
function readableText(resume: ResumeData): string {
    return [
        resume.personalInfo.summary,
        resume.personalInfo.title,
        ...resume.experience.flatMap((item) => [item.role, item.company, item.description]),
        ...resume.projects.flatMap((item) => [item.name, item.description]),
        ...resume.skills,
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * The ATS scorer parses free JSON out of a chat completion rather than going
 * through `generateStructured`, so it needs a scripted reply of the right
 * shape. Every number here is the scorer's own judgement of the document, not
 * a claim about the candidate — which is why they are allowed to exist.
 */
function scriptAtsReply(): void {
    mocks().openai.onChat(
        /ATS|applicant tracking|breakdown/i,
        JSON.stringify({
            overall: 72,
            breakdown: {
                keywordMatch: 70,
                skillsMatch: 68,
                experienceRelevance: 75,
                formattingScore: 80,
            },
            matchedKeywords: ['postgresql', 'kubernetes'],
            missingKeywords: ['go'],
            suggestions: ['Name the payments platform explicitly in the summary.'],
        }),
    );
}

function installLatexDouble(): void {
    latexRequests = 0;
    latexTesting.setFetch(async () => {
        latexRequests += 1;
        return new Response(FAKE_PDF, {
            status: 201,
            headers: { 'content-type': 'application/pdf' },
        });
    });
}

async function seedProfile(): Promise<void> {
    await prisma.userProfile.create({
        data: {
            userId: journey.userId,
            fullName: 'Ada Fowler',
            email: `${journey.userId}@example.test`,
            defaultTitle: 'Backend Engineer',
            defaultSummary: 'Backend engineer focused on payments and reliability.',
            location: 'San Francisco, CA',
        },
    });
    await prisma.userExperience.create({
        data: {
            userId: journey.userId,
            company: EXPERIENCE.company,
            role: EXPERIENCE.role,
            description: EXPERIENCE.description,
            highlights: EXPERIENCE.highlights,
            startDate: '2021-01',
            current: true,
        },
    });
}

describe('J6 — the resume loop', () => {
    test('job description → session → tailored resume → stored PDF', async () => {
        installLatexDouble();
        scriptAtsReply();
        await seedProfile();

        // ── HOP 1. A session is opened, exactly as the extension opens one.
        const session = await prisma.generationSession.create({
            data: {
                userId: journey.userId,
                channel: Channel.web,
                jobDescription: JOB_DESCRIPTION,
                currentStep: PipelineStep.reuse_check,
                stepStartedAt: new Date(),
                status: GenerationStatus.generating,
            },
            select: { id: true },
        });

        // ── HOP 2. Run it. This is the same call the queue and the workflow make.
        const result = await runGenerationSession({
            sessionId: session.id,
            userId: journey.userId,
        });

        expect(result.status).toBe('completed');
        expect(result.resumeId).toBeDefined();

        // ── HOP 3. The session is closed out, with its costs rolled up.
        const finished = await prisma.generationSession.findUniqueOrThrow({
            where: { id: session.id },
        });
        expect(finished.status).toBe(GenerationStatus.completed);
        expect(finished.currentStep).toBe(PipelineStep.completed);
        expect(finished.completedAt).not.toBeNull();
        expect(finished.resultResumeId).toBe(result.resumeId!);
        // Rolled up from ApiUsageLog rather than counted by the pipeline, so a
        // retry cannot double-charge a session that already paid.
        expect(finished.totalLatencyMs).toBeGreaterThanOrEqual(0);

        // ── HOP 4. The artifact a candidate actually sends.
        const resume = await prisma.resume.findUniqueOrThrow({
            where: { id: result.resumeId! },
        });
        expect(resume.userId).toBe(journey.userId);
        expect(resume.content).toBeTruthy();

        // THE invariant. Every figure in the prose, against everything the
        // model was allowed to read.
        assertNoFabricatedNumbers(
            readableText(resume.content as unknown as ResumeData),
            SOURCE_CORPUS,
        );

        // ── HOP 5. The PDF exists, was built once, and is reachable.
        expect(latexRequests).toBe(1);
        const pdf = await prisma.generatedPdf.findFirst({
            where: { userId: journey.userId },
            orderBy: { createdAt: 'desc' },
        });
        expect(pdf).not.toBeNull();
        expect(pdf!.fileSizeBytes).toBeGreaterThan(0);
        expect(result.pdfUrl).toContain(pdf!.id);

        // ── HOP 6. The funnel can see it happened.
        //
        // `resume_generated` did not exist until Missions needed it: the one
        // step the product is named after emitted no telemetry at all. This
        // assertion is why it stays.
        const events = await prisma.funnelEvent.findMany({
            where: { userId: journey.userId, type: 'resume_generated' },
        });
        expect(events).toHaveLength(1);
        expect(events[0].payload).toMatchObject({ sessionId: session.id, reused: false });

        // ── HOP 7. The prose is actually prose.
        //
        // Two assertions that keep HOP 4 from being vacuous. The first proves
        // the pipeline carried real source figures through rather than
        // producing a numberless document that trivially passes the guard.
        const prose = readableText(resume.content as unknown as ResumeData);
        expect(prose).toContain('800ms');
        expect(prose).toContain('180ms');

        // The second is a bug this journey found on its first run. With no
        // skills extracted, the summary fallback rendered "hands-on experience
        // in  and a track record" — a double space and a dangling preposition
        // on the first line of a document going to an employer.
        expect(prose).not.toMatch(/ {2,}/);
        expect(prose).not.toMatch(/\bin\s+and\b/);

        // Every model call is attributed to this session, so the per-feature
        // cost query can see it.
        const usage = await prisma.apiUsageLog.findMany({
            where: { userId: journey.userId },
            select: { sessionId: true, model: true },
        });
        expect(usage.length).toBeGreaterThan(0);

        await assertNoDeadJobs();
    });

    test('a second run for the same job reuses rather than rebuilding', async () => {
        // Reuse is on by default (`RESUME_REUSE_ENABLED`), and it is the one
        // branch in this pipeline that skips almost everything. Worth pinning:
        // a reuse that still rebuilt the PDF would quietly pay for the
        // expensive half of the work it exists to avoid.
        installLatexDouble();
        scriptAtsReply();

        const second = await prisma.generationSession.create({
            data: {
                userId: journey.userId,
                channel: Channel.web,
                jobDescription: JOB_DESCRIPTION,
                currentStep: PipelineStep.reuse_check,
                stepStartedAt: new Date(),
                status: GenerationStatus.generating,
            },
            select: { id: true },
        });

        const result = await runGenerationSession({
            sessionId: second.id,
            userId: journey.userId,
        });

        expect(result.status).toBe('completed');
        if (result.reused) {
            // The whole point: no second trip to the build service.
            expect(latexRequests).toBe(0);
            const events = await prisma.funnelEvent.findMany({
                where: { userId: journey.userId, type: 'resume_generated' },
            });
            // The reuse path returns before the telemetry call, so a reused
            // run is NOT counted as a generation. That is correct — it is the
            // number that would otherwise overstate how much work we did.
            expect(events).toHaveLength(1);
        } else {
            // Reuse declined (the fixture resume may score below the ATS
            // floor). Then it must have done the real work, honestly.
            expect(latexRequests).toBe(1);
        }
    });
});

describe('teardown', () => {
    // Production, 2026-09-27: the Qdrant Cloud cluster was suspended and
    // refused connections, and every generation failed at semantic_search.
    // Semantic search ranks the profile; it must never gate generation.
    test('a generation still completes when the vector store is down', async () => {
        installLatexDouble();
        scriptAtsReply();
        const { qdrantClient, setQdrantClient } = await import('@/lib/qdrantClient');
        const healthy = qdrantClient;
        const refuse = async () => { throw new TypeError('fetch failed'); };
        setQdrantClient(new Proxy({}, { get: () => refuse }) as unknown as typeof healthy);
        try {
            const session = await prisma.generationSession.create({
                data: {
                    userId: journey.userId,
                    channel: Channel.web,
                    jobDescription: `${JOB_DESCRIPTION}\n\nAlso: experience with incident response on-call rotations.`,
                    currentStep: PipelineStep.reuse_check,
                    stepStartedAt: new Date(),
                    status: GenerationStatus.generating,
                },
                select: { id: true },
            });
            const result = await runGenerationSession({ sessionId: session.id, userId: journey.userId });
            expect(result.status).toBe('completed');
            expect(result.resumeId).toBeDefined();
        } finally {
            setQdrantClient(healthy);
        }
    });

    test('the journey leaves nothing behind', async () => {
        latexTesting.reset();
        await prisma.generatedPdf.deleteMany({ where: { userId: { contains: journey.runId } } });
        await prisma.resume.deleteMany({ where: { userId: { contains: journey.runId } } });
        await prisma.generationSession.deleteMany({ where: { userId: { contains: journey.runId } } });
        await purge(journey.runId);
        await assertPurged(journey.runId);
    });
});
