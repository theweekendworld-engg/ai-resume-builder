import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

type OpenAiPrice = {
  inputPer1M: number;
  outputPer1M: number;
};

const OPENAI_PRICING_USD_PER_1M: Record<string, OpenAiPrice> = {
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
  'text-embedding-3-small': { inputPer1M: 0.02, outputPer1M: 0 },
  'text-embedding-3-large': { inputPer1M: 0.13, outputPer1M: 0 },
};

export type TrackableCall = {
  userId: string;
  sessionId?: string;
  operation: string;
  metadata?: Record<string, unknown>;
};

export type UsageLogInput = {
  userId: string;
  sessionId?: string;
  operation: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'success' | 'failed';
  metadata?: Record<string, unknown>;
};

export function getCurrentBillingPeriod(now = new Date()): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function toTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveOpenAiPrice(model: string): OpenAiPrice {
  const normalized = (model || '').toLowerCase().trim();
  return OPENAI_PRICING_USD_PER_1M[normalized] ?? { inputPer1M: 0, outputPer1M: 0 };
}

export function calculateOpenAiCostUsd(params: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): number {
  const price = resolveOpenAiPrice(params.model);
  const inputTokens = Math.max(0, params.inputTokens ?? 0);
  const outputTokens = Math.max(0, params.outputTokens ?? 0);
  const inputCost = (inputTokens / 1_000_000) * price.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * price.outputPer1M;
  return toTwoDecimals(inputCost + outputCost);
}

export async function logUsageEvent(input: UsageLogInput): Promise<void> {
  const totalTokens = Math.max(0, input.totalTokens ?? ((input.inputTokens ?? 0) + (input.outputTokens ?? 0)));

  await prisma.apiUsageLog.create({
    data: {
      userId: input.userId,
      sessionId: input.sessionId,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      inputTokens: Math.max(0, input.inputTokens ?? 0),
      outputTokens: Math.max(0, input.outputTokens ?? 0),
      totalTokens,
      costUsd: Math.max(0, input.costUsd ?? 0),
      latencyMs: Math.max(0, input.latencyMs ?? 0),
      status: input.status ?? 'success',
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}

function getMonthlyTokenLimit(): number {
  return Number(process.env.USAGE_MAX_MONTHLY_TOKENS_PER_USER ?? 300000);
}

function getMonthlyCostLimitUsd(): number {
  return Number(process.env.USAGE_MAX_MONTHLY_COST_USD_PER_USER ?? 10);
}

async function getCurrentPeriodUsage(userId: string): Promise<{ totalTokens: number; totalCostUsd: number }> {
  const { start, end } = getCurrentBillingPeriod();

  const summary = await prisma.userUsageSummary.findUnique({
    where: {
      userId_periodStart: {
        userId,
        periodStart: start,
      },
    },
    select: {
      totalTokens: true,
      totalCostUsd: true,
    },
  });

  if (summary) {
    return {
      totalTokens: summary.totalTokens,
      totalCostUsd: summary.totalCostUsd,
    };
  }

  const aggregate = await prisma.apiUsageLog.aggregate({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
      status: 'success',
    },
    _sum: {
      totalTokens: true,
      costUsd: true,
    },
  });

  return {
    totalTokens: aggregate._sum.totalTokens ?? 0,
    totalCostUsd: aggregate._sum.costUsd ?? 0,
  };
}

export async function enforceUsageLimit(userId: string): Promise<void> {
  const tokenLimit = getMonthlyTokenLimit();
  const costLimit = getMonthlyCostLimitUsd();
  if (tokenLimit <= 0 && costLimit <= 0) return;

  const usage = await getCurrentPeriodUsage(userId);

  if (tokenLimit > 0 && usage.totalTokens >= tokenLimit) {
    throw new Error('Monthly token usage limit reached for your account');
  }

  if (costLimit > 0 && usage.totalCostUsd >= costLimit) {
    throw new Error('Monthly usage cost limit reached for your account');
  }
}

export async function trackedChatCompletion(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  tracking: TrackableCall
) {
  await enforceUsageLimit(tracking.userId);

  const start = Date.now();
  try {
    const result = await openai.chat.completions.create(params);
    const latencyMs = Date.now() - start;
    const inputTokens = result.usage?.prompt_tokens ?? 0;
    const outputTokens = result.usage?.completion_tokens ?? 0;

    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      inputTokens,
      outputTokens,
      totalTokens: result.usage?.total_tokens ?? (inputTokens + outputTokens),
      costUsd: calculateOpenAiCostUsd({
        model: String(params.model),
        inputTokens,
        outputTokens,
      }),
      latencyMs,
      status: 'success',
      metadata: tracking.metadata,
    });

    return result;
  } catch (error) {
    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        ...(tracking.metadata ?? {}),
        error: error instanceof Error ? error.message : 'Unknown OpenAI error',
      },
    });
    throw error;
  }
}

export async function trackedEmbeddingCreate(
  params: OpenAI.EmbeddingCreateParams,
  tracking: TrackableCall
) {
  await enforceUsageLimit(tracking.userId);

  const start = Date.now();
  try {
    const result = await openai.embeddings.create(params);
    const inputTokens = result.usage?.prompt_tokens ?? 0;

    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      inputTokens,
      outputTokens: 0,
      totalTokens: inputTokens,
      costUsd: calculateOpenAiCostUsd({
        model: String(params.model),
        inputTokens,
        outputTokens: 0,
      }),
      latencyMs: Date.now() - start,
      status: 'success',
      metadata: tracking.metadata,
    });

    return result;
  } catch (error) {
    await logUsageEvent({
      userId: tracking.userId,
      sessionId: tracking.sessionId,
      operation: tracking.operation,
      provider: 'openai',
      model: String(params.model),
      latencyMs: Date.now() - start,
      status: 'failed',
      metadata: {
        ...(tracking.metadata ?? {}),
        error: error instanceof Error ? error.message : 'Unknown embedding error',
      },
    });
    throw error;
  }
}

type OperationSummary = {
  calls: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
};

function summarizeLogs(logs: Array<{
  operation: string;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
}>): Record<string, OperationSummary> {
  const buckets = new Map<string, { calls: number; tokens: number; costUsd: number; latencyMs: number }>();
  for (const log of logs) {
    const current = buckets.get(log.operation) ?? { calls: 0, tokens: 0, costUsd: 0, latencyMs: 0 };
    current.calls += 1;
    current.tokens += log.totalTokens;
    current.costUsd += log.costUsd;
    current.latencyMs += log.latencyMs;
    buckets.set(log.operation, current);
  }

  const result: Record<string, OperationSummary> = {};
  for (const [operation, entry] of buckets.entries()) {
    result[operation] = {
      calls: entry.calls,
      tokens: entry.tokens,
      costUsd: toTwoDecimals(entry.costUsd),
      avgLatencyMs: entry.calls > 0 ? Math.round(entry.latencyMs / entry.calls) : 0,
    };
  }

  return result;
}

export async function upsertUserUsageSummary(params: {
  userId: string;
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<void> {
  const period = params.periodStart && params.periodEnd
    ? { start: params.periodStart, end: params.periodEnd }
    : getCurrentBillingPeriod();

  const logs = await prisma.apiUsageLog.findMany({
    where: {
      userId: params.userId,
      createdAt: { gte: period.start, lt: period.end },
      status: 'success',
    },
    select: {
      operation: true,
      totalTokens: true,
      costUsd: true,
      latencyMs: true,
    },
  });

  const totalTokens = logs.reduce((acc, log) => acc + log.totalTokens, 0);
  const totalCostUsd = toTwoDecimals(logs.reduce((acc, log) => acc + log.costUsd, 0));
  const totalGenerations = logs.filter((log) => log.operation === 'resume_assembly').length;
  const totalPdfs = logs.filter((log) => log.operation === 'pdf_storage').length;
  const breakdown = summarizeLogs(logs);

  await prisma.userUsageSummary.upsert({
    where: {
      userId_periodStart: {
        userId: params.userId,
        periodStart: period.start,
      },
    },
    update: {
      periodEnd: period.end,
      totalTokens,
      totalCostUsd,
      totalGenerations,
      totalPdfs,
      breakdown: breakdown as Prisma.InputJsonValue,
    },
    create: {
      userId: params.userId,
      periodStart: period.start,
      periodEnd: period.end,
      totalTokens,
      totalCostUsd,
      totalGenerations,
      totalPdfs,
      breakdown: breakdown as Prisma.InputJsonValue,
    },
  });
}

export async function upsertAllUserUsageSummaries(params?: {
  periodStart?: Date;
  periodEnd?: Date;
}): Promise<number> {
  const period = params?.periodStart && params?.periodEnd
    ? { start: params.periodStart, end: params.periodEnd }
    : getCurrentBillingPeriod();

  const users = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: period.start, lt: period.end } },
    distinct: ['userId'],
    select: { userId: true },
  });

  for (const user of users) {
    await upsertUserUsageSummary({
      userId: user.userId,
      periodStart: period.start,
      periodEnd: period.end,
    });
  }

  return users.length;
}
