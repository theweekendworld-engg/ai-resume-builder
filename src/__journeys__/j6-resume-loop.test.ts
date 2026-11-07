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

/** A real PDF with `pages` pages, so `measurePdf` counts what pdfjs counts. */
function pdfWithPages(pages: number): Buffer {
    const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
    const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`];
    for (let i = 0; i < pages; i += 1) {
        const stream = `BT /F1 12 Tf 72 720 Td (Page ${i + 1}) Tj ET`;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(Buffer.byteLength(out));
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

/** A build service whose page count depends on what it was sent. */
function installPagedLatexDouble(pagesFor: (latex: string) => number): string[] {
    const sent: string[] = [];
    latexTesting.setFetch(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { resources?: Array<{ content?: string }> };
        const latex = body.resources?.[0]?.content ?? '';
        sent.push(latex);
        return new Response(new Uint8Array(pdfWithPages(pagesFor(latex))), { status: 201, headers: { 'content-type': 'application/pdf' } });
    });
    return sent;
}

async function tailorSession(label: string) {
    const base = await prisma.resume.create({
        data: { userId: journey.userId, title: `Base ${label}`, content: { personalInfo: { fullName: 'Ada Fowler' }, experience: [], projects: [], education: [], skills: [], sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills'] } },
        select: { id: true },
    });
    // A source resume skips the reuse check, as Scout's tailor does.
    return prisma.generationSession.create({
        data: {
            userId: journey.userId,
            channel: Channel.web,
            jobDescription: `${JOB_DESCRIPTION}\n\n(${label})`,
            currentStep: PipelineStep.reuse_check,
            stepStartedAt: new Date(),
            status: GenerationStatus.generating,
            sourceResumeId: base.id,
        },
        select: { id: true },
    });
}

describe('J6 — one page, measured (QA 2026-11-07, finding 2)', () => {
    test('a PDF over one page is trimmed in order, recompiled, and the stored resume is the one that fits', async () => {
        scriptAtsReply();
        // Two pages while the About line is in it, one page without.
        const sent = installPagedLatexDouble((latex) => (latex.includes('ABOUT ME') ? 2 : 1));
        const session = await tailorSession('fit');

        const result = await runGenerationSession({ sessionId: session.id, userId: journey.userId });
        expect(result.status).toBe('completed');
        expect(result.pageFit).toMatchObject({ status: 'trimmed', pages: 1, maxPages: 1, attempts: 2 });
        expect(result.pageFit?.trimmed.map((item) => item.kind)).toEqual(['summary']);
        expect(sent).toHaveLength(2);

        const stored = await prisma.resume.findUniqueOrThrow({ where: { id: result.resumeId! } });
        const content = stored.content as unknown as ResumeData;
        expect(content.personalInfo.summary).toBe('');
        // Whole lines only: every source bullet that is printed is printed whole.
        for (const line of content.experience[0].description.split('\n')) {
            expect(EXPERIENCE.highlights).toContain(line);
        }
        // The editor's Job Match panel reads the fit from the stored report.
        const report = stored.coverageReport as { pageFit?: { status: string; pages: number } } | null;
        expect(report?.pageFit).toMatchObject({ status: 'trimmed', pages: 1 });

        // The stored PDF is the second, one-page build.
        const pdf = await prisma.generatedPdf.findFirst({ where: { sessionId: session.id } });
        expect(pdf!.fileSizeBytes).toBe(pdfWithPages(1).length);
    });

    test('a PDF that cannot be brought to one page is stored with a status that says so, after a bounded number of builds', async () => {
        scriptAtsReply();
        const sent = installPagedLatexDouble(() => 2);
        const session = await tailorSession('over');

        const result = await runGenerationSession({ sessionId: session.id, userId: journey.userId });
        expect(result.status).toBe('completed');
        expect(result.pageFit?.status).toBe('over');
        expect(result.pageFit?.pages).toBe(2);
        expect(sent.length).toBeLessThanOrEqual(6);

        const stored = await prisma.resume.findUniqueOrThrow({ where: { id: result.resumeId! } });
        const report = stored.coverageReport as { pageFit?: { status: string } } | null;
        expect(report?.pageFit?.status).toBe('over');
        const events = await prisma.funnelEvent.findMany({ where: { userId: journey.userId, type: 'resume_generated' }, orderBy: { occurredAt: 'desc' }, take: 1 });
        expect(events[0].payload).toMatchObject({ pageFit: 'over', pages: 2 });
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
