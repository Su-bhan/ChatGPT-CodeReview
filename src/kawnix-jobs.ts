import { createHash, randomUUID } from 'node:crypto';

import type {
  KawnixProviderInput,
  KawnixStartInput,
} from './provider-contract.js';
import type { KawnixProviderHandlers } from './kawnix-provider.js';
import {
  reviewPullRequest,
  type KawnixGitHubClient,
} from './kawnix-review.js';
import type { Chat } from './chat.js';

export const KAWNIX_CONCURRENCY_LIMITS = {
  maxConcurrentPerOwner: 1,
  maxConcurrentGlobal: 5,
} as const;

export const KAWNIX_RETENTION_DEFAULTS = {
  queuedTtlMs: 24 * 60 * 60 * 1000,
  runningTtlMs: 30 * 60 * 1000,
  terminalTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export type KawnixCleanupOptions = {
  now?: Date;
  queuedTtlMs?: number;
  runningTtlMs?: number;
  terminalTtlMs?: number;
};

export type KawnixCleanupSummary = {
  expired: number;
  deleted: number;
};

export type KawnixJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type KawnixJob = {
  id: string;
  ownerId: string;
  requestHash: string;
  status: KawnixJobStatus;
  stage: 'queued' | 'reviewing' | 'publishing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  attempt?: number;
  maxAttempts?: number;
  input: Omit<KawnixStartInput, 'operation'>;
  result?: Record<string, unknown>;
  failure?: {
    code: string;
    message: string;
  };
};

export type KawnixJobStore = {
  create(job: KawnixJob): Promise<void>;
  createOrGetByIdempotency?(
    job: KawnixJob
  ): Promise<KawnixJob | undefined>;
  get(jobId: string): Promise<KawnixJob | undefined>;
  claimNextQueued(
    staleAfterMs?: number,
    limits?: typeof KAWNIX_CONCURRENCY_LIMITS
  ): Promise<KawnixJob | undefined>;
  update(job: KawnixJob): Promise<void>;
  findByIdempotency(
    ownerId: string,
    idempotencyKey: string
  ): Promise<KawnixJob | undefined>;
  cleanup(options?: KawnixCleanupOptions): Promise<KawnixCleanupSummary>;
};

export class InMemoryKawnixJobStore implements KawnixJobStore {
  private readonly jobs = new Map<string, KawnixJob>();

  async create(job: KawnixJob) {
    this.jobs.set(job.id, job);
  }

  async get(jobId: string) {
    return this.jobs.get(jobId);
  }

  async claimNextQueued(
    staleAfterMs = 15 * 60 * 1000,
    limits = KAWNIX_CONCURRENCY_LIMITS
  ) {
    const now = Date.now();
    for (const candidate of this.jobs.values()) {
      if (
        candidate.status === 'running' &&
        now - Date.parse(candidate.updatedAt) > staleAfterMs
      ) {
        this.jobs.set(candidate.id, {
          ...candidate,
          status: 'queued',
          stage: 'queued',
          updatedAt: new Date(now).toISOString(),
        });
      }
    }
    const running = Array.from(this.jobs.values()).filter(
      (candidate) => candidate.status === 'running'
    );
    if (running.length >= limits.maxConcurrentGlobal) {
      return undefined;
    }
    const job = Array.from(this.jobs.values()).find((candidate) => {
      if (candidate.status !== 'queued') {
        return false;
      }
      return (
        running.filter((active) => active.ownerId === candidate.ownerId).length <
        limits.maxConcurrentPerOwner
      );
    });
    if (!job) {
      return undefined;
    }
    const claimed = {
      ...job,
      status: 'running' as const,
      stage: 'reviewing' as const,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(claimed.id, claimed);
    return claimed;
  }

  async update(job: KawnixJob) {
    this.jobs.set(job.id, job);
  }

  async findByIdempotency(ownerId: string, idempotencyKey: string) {
    for (const job of this.jobs.values()) {
      if (
        job.ownerId === ownerId &&
        job.input.idempotency_key === idempotencyKey
      ) {
        return job;
      }
    }
    return undefined;
  }

  async cleanup(
    options: KawnixCleanupOptions = {}
  ): Promise<KawnixCleanupSummary> {
    const now = options.now?.getTime() ?? Date.now();
    const queuedCutoff = now - (options.queuedTtlMs ?? KAWNIX_RETENTION_DEFAULTS.queuedTtlMs);
    const runningCutoff = now - (options.runningTtlMs ?? KAWNIX_RETENTION_DEFAULTS.runningTtlMs);
    const terminalCutoff = now - (options.terminalTtlMs ?? KAWNIX_RETENTION_DEFAULTS.terminalTtlMs);
    let expired = 0;
    let deleted = 0;

    for (const job of this.jobs.values()) {
      const updatedAt = Date.parse(job.updatedAt);
      const isStale =
        (job.status === 'queued' && updatedAt < queuedCutoff) ||
        (job.status === 'running' && updatedAt < runningCutoff);
      if (isStale) {
        this.jobs.set(job.id, {
          ...job,
          status: 'expired',
          stage: 'failed',
          updatedAt: new Date(now).toISOString(),
          failure: {
            code: 'job_expired',
            message: 'The review job expired before it completed.',
          },
        });
        expired += 1;
      } else if (
        ['completed', 'failed', 'cancelled', 'expired'].includes(job.status) &&
        updatedAt < terminalCutoff
      ) {
        this.jobs.delete(job.id);
        deleted += 1;
      }
    }
    return { expired, deleted };
  }
}

const hashInput = (input: KawnixStartInput) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        repository: input.repository,
        pull_request_number: input.pull_request_number,
        commit_sha: input.commit_sha,
        publishing_mode: input.publishing_mode,
        prompt: input.prompt,
        include_patterns: input.include_patterns,
        ignore_patterns: input.ignore_patterns,
      })
    )
    .digest('hex');

const summarizeJob = (job: KawnixJob): Record<string, unknown> => ({
  job_id: job.id,
  status: job.status,
  stage: job.stage,
  repository: `${job.input.repository.owner}/${job.input.repository.name}`,
  pull_request_number: job.input.pull_request_number,
  created_at: job.createdAt,
  updated_at: job.updatedAt,
  ...(job.result ? { result: job.result } : {}),
  ...(job.failure ? { failure: job.failure } : {}),
});

export const createInMemoryKawnixJobHandlers = (
  store: KawnixJobStore
): KawnixProviderHandlers => ({
  start: async (input, request) => {
    const ownerId = getProviderOwnerId(request);
    const idempotencyKey = input.idempotency_key;
    const requestHash = hashInput(input);

    if (idempotencyKey) {
      const existing = await store.findByIdempotency(ownerId, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new KawnixJobError(
            409,
            'idempotency_conflict',
            'The idempotency key was already used for a different request.'
          );
        }
        return summarizeJob(existing);
      }
    }

    const now = new Date().toISOString();
    const job: KawnixJob = {
      id: `job_${randomUUID()}`,
      ownerId,
      requestHash,
      status: 'queued',
      stage: 'queued',
      createdAt: now,
      updatedAt: now,
      attempt: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      input: {
        repository: input.repository,
        pull_request_number: input.pull_request_number,
        commit_sha: input.commit_sha,
        publishing_mode: input.publishing_mode,
        prompt: input.prompt,
        include_patterns: input.include_patterns,
        ignore_patterns: input.ignore_patterns,
        idempotency_key: input.idempotency_key,
      },
    };

    if (store.createOrGetByIdempotency && idempotencyKey) {
      const existing = await store.createOrGetByIdempotency(job);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new KawnixJobError(
            409,
            'idempotency_conflict',
            'The idempotency key was already used for a different request.'
          );
        }
        return summarizeJob(existing);
      }
    } else {
      await store.create(job);
    }
    return summarizeJob(job);
  },
  status: async (input, request) => {
    const job = await store.get(input.job_id);
    if (!job || job.ownerId !== getProviderOwnerId(request)) {
      throw new KawnixJobError(
        404,
        'job_not_found',
        'The requested review job was not found.'
      );
    }
    return summarizeJob(job);
  },
});

export const runKawnixJob = async (
  job: KawnixJob,
  store: KawnixJobStore,
  execute: (input: KawnixStartInput) => Promise<Record<string, unknown>>
) => {
  const running: KawnixJob = {
    ...job,
    status: 'running',
    stage: 'reviewing',
    updatedAt: new Date().toISOString(),
  };
  await store.update(running);

  try {
    const result = await execute(getJobInput(running));
    await store.update({
      ...running,
      status: 'completed',
      stage: 'completed',
      updatedAt: new Date().toISOString(),
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Review job failed.';
    await store.update({
      ...running,
      status: 'failed',
      stage: 'failed',
      updatedAt: new Date().toISOString(),
      failure: {
        code: 'review_failed',
        message,
      },
    });
  }
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const isRetryableJobError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const status = 'status' in error ? error.status : undefined;
  if (typeof status === 'number') {
    return [429, 502, 503, 504].includes(status);
  }
  const code = 'code' in error ? error.code : undefined;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(code));
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new KawnixJobError(504, 'review_timeout', 'Review job timed out.')),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const processNextKawnixJob = async (
  store: KawnixJobStore,
  execute: (input: KawnixStartInput) => Promise<Record<string, unknown>>,
  options: {
    maxAttempts?: number;
    timeoutMs?: number;
  } = {}
) => {
  const job = await store.claimNextQueued();
  if (!job) {
    return false;
  }

  try {
    const result = await withTimeout(
      execute(getJobInput(job)),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    await store.update({
      ...job,
      status: 'completed',
      stage: 'completed',
      updatedAt: new Date().toISOString(),
      result,
    });
  } catch (error) {
    const attempt = job.attempt ?? 1;
    const maxAttempts = job.maxAttempts ?? options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (isRetryableJobError(error) && attempt < maxAttempts) {
      await store.update({
        ...job,
        status: 'queued',
        stage: 'queued',
        updatedAt: new Date().toISOString(),
        attempt: attempt + 1,
        maxAttempts,
      });
      return true;
    }
    await store.update({
      ...job,
      status: 'failed',
      stage: 'failed',
      updatedAt: new Date().toISOString(),
      failure: {
        code:
          error && typeof error === 'object' && 'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : 'review_failed',
        message: error instanceof Error ? error.message : 'Review job failed.',
      },
      attempt,
      maxAttempts,
    });
  }
  return true;
};

export const createReviewJobExecutor = ({
  github,
  chat,
}: {
  github: KawnixGitHubClient;
  chat: Pick<Chat, 'codeReview'>;
}) => (input: KawnixStartInput) =>
  reviewPullRequest({ input, github, chat }) as Promise<Record<string, unknown>>;

export class KawnixJobError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'KawnixJobError';
    this.status = status;
    this.code = code;
  }
}

export const getProviderOwnerId = (request: Request) => {
  const authorization = request.headers.get('Authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  return createHash('sha256').update(token).digest('hex');
};

export const getJobInput = (
  job: KawnixJob
): Extract<KawnixProviderInput, { operation: 'start' }> =>
  ({
    operation: 'start',
    ...job.input,
  }) as Extract<KawnixProviderInput, { operation: 'start' }>;
