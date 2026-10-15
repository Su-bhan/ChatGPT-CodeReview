import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import {
  KAWNIX_CONCURRENCY_LIMITS,
  KAWNIX_RETENTION_DEFAULTS,
  type KawnixCleanupOptions,
  type KawnixCleanupSummary,
  type KawnixJob,
  type KawnixJobStore,
} from './kawnix-jobs.js';

type JobRow = QueryResultRow & {
  id: string;
  owner_id: string;
  request_hash: string;
  status: KawnixJob['status'];
  stage: KawnixJob['stage'];
  created_at: Date;
  updated_at: Date;
  attempt: number;
  max_attempts: number;
  input: KawnixJob['input'];
  result: KawnixJob['result'] | null;
  failure: KawnixJob['failure'] | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kawnix_review_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input JSONB NOT NULL,
  result JSONB,
  failure JSONB,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS kawnix_review_jobs_owner_id_idx
  ON kawnix_review_jobs (owner_id);
ALTER TABLE kawnix_review_jobs
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE kawnix_review_jobs
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
`;

const toJob = (row: JobRow): KawnixJob => ({
  id: row.id,
  ownerId: row.owner_id,
  requestHash: row.request_hash,
  status: row.status,
  stage: row.stage,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  attempt: row.attempt,
  maxAttempts: row.max_attempts,
  input: row.input,
  ...(row.result ? { result: row.result } : {}),
  ...(row.failure ? { failure: row.failure } : {}),
});

export class PostgresKawnixJobStore implements KawnixJobStore {
  private readonly pool: Pool;
  private ready: Promise<void> | undefined;

  constructor(config: PoolConfig | string) {
    this.pool = new Pool(
      typeof config === 'string'
        ? {
            connectionString: config,
            connectionTimeoutMillis: 10_000,
            idleTimeoutMillis: 30_000,
            max: 5,
          }
        : config
    );
  }

  private async initialize() {
    await this.pool.query(SCHEMA);
  }

  private async query<T extends QueryResultRow>(
    text: string,
    values: unknown[] = []
  ) {
    await this.ensureReady();
    return this.pool.query<T>(text, values);
  }

  private ensureReady() {
    this.ready ??= this.initialize();
    return this.ready;
  }

  async create(job: KawnixJob) {
    await this.query(
      `INSERT INTO kawnix_review_jobs
       (id, owner_id, idempotency_key, request_hash, status, stage,
        created_at, updated_at, attempt, max_attempts, input, result, failure)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        job.id,
        job.ownerId,
        job.input.idempotency_key ?? null,
        job.requestHash,
        job.status,
        job.stage,
        job.createdAt,
        job.updatedAt,
        job.attempt ?? 1,
        job.maxAttempts ?? 3,
        job.input,
        job.result ?? null,
        job.failure ?? null,
      ]
    );
  }

  async createOrGetByIdempotency(job: KawnixJob) {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<JobRow>(
        `INSERT INTO kawnix_review_jobs
         (id, owner_id, idempotency_key, request_hash, status, stage,
          created_at, updated_at, attempt, max_attempts, input, result, failure)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (owner_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          job.id,
          job.ownerId,
          job.input.idempotency_key,
          job.requestHash,
          job.status,
          job.stage,
          job.createdAt,
          job.updatedAt,
          job.attempt ?? 1,
          job.maxAttempts ?? 3,
          job.input,
          job.result ?? null,
          job.failure ?? null,
        ]
      );
      if (inserted.rowCount) {
        await client.query('COMMIT');
        return undefined;
      }
      const existing = await client.query<JobRow>(
        `SELECT * FROM kawnix_review_jobs
         WHERE owner_id = $1 AND idempotency_key = $2
         FOR SHARE`,
        [job.ownerId, job.input.idempotency_key]
      );
      await client.query('COMMIT');
      return existing.rows[0] ? toJob(existing.rows[0]) : undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(jobId: string) {
    const result = await this.query<JobRow>(
      'SELECT * FROM kawnix_review_jobs WHERE id = $1',
      [jobId]
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async claimNextQueued(
    staleAfterMs = 15 * 60 * 1000,
    limits = KAWNIX_CONCURRENCY_LIMITS
  ) {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [874291]);
      const staleBefore = new Date(Date.now() - staleAfterMs);
      await client.query(
        `UPDATE kawnix_review_jobs
         SET status = 'queued', stage = 'queued', updated_at = $1
         WHERE status = 'running' AND updated_at < $1`,
        [staleBefore]
      );
      const running = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM kawnix_review_jobs
         WHERE status = 'running'`
      );
      if (Number(running.rows[0]?.total ?? 0) >= limits.maxConcurrentGlobal) {
        await client.query('COMMIT');
        return undefined;
      }
      const result = await client.query<JobRow>(
        `SELECT * FROM kawnix_review_jobs
         WHERE status = 'queued'
           AND NOT EXISTS (
             SELECT 1
             FROM kawnix_review_jobs active
             WHERE active.status = 'running'
               AND active.owner_id = kawnix_review_jobs.owner_id
             GROUP BY active.owner_id
             HAVING COUNT(*) >= $1
           )
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [limits.maxConcurrentPerOwner]
      );
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return undefined;
      }
      const now = new Date();
      const updated = await client.query<JobRow>(
        `UPDATE kawnix_review_jobs
         SET status = 'running', stage = 'reviewing', updated_at = $2
         WHERE id = $1
         RETURNING *`,
        [row.id, now]
      );
      await client.query('COMMIT');
      return updated.rows[0] ? toJob(updated.rows[0]) : undefined;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(job: KawnixJob) {
    await this.query(
      `UPDATE kawnix_review_jobs
       SET status = $2, stage = $3, updated_at = $4, attempt = $5,
           max_attempts = $6, input = $7, result = $8, failure = $9
       WHERE id = $1`,
      [
        job.id,
        job.status,
        job.stage,
        job.updatedAt,
        job.attempt ?? 1,
        job.maxAttempts ?? 3,
        job.input,
        job.result ?? null,
        job.failure ?? null,
      ]
    );
  }

  async findByIdempotency(ownerId: string, idempotencyKey: string) {
    const result = await this.query<JobRow>(
      `SELECT * FROM kawnix_review_jobs
       WHERE owner_id = $1 AND idempotency_key = $2`,
      [ownerId, idempotencyKey]
    );
    return result.rows[0] ? toJob(result.rows[0]) : undefined;
  }

  async cleanup(
    options: KawnixCleanupOptions = {}
  ): Promise<KawnixCleanupSummary> {
    const now = options.now ?? new Date();
    const queuedCutoff = new Date(
      now.getTime() -
        (options.queuedTtlMs ?? KAWNIX_RETENTION_DEFAULTS.queuedTtlMs)
    );
    const runningCutoff = new Date(
      now.getTime() -
        (options.runningTtlMs ?? KAWNIX_RETENTION_DEFAULTS.runningTtlMs)
    );
    const terminalCutoff = new Date(
      now.getTime() -
        (options.terminalTtlMs ?? KAWNIX_RETENTION_DEFAULTS.terminalTtlMs)
    );
    const expired = await this.query<{ count: string }>(
      `WITH expired AS (
         UPDATE kawnix_review_jobs
         SET status = 'expired',
             stage = 'failed',
             updated_at = $1,
             failure = $2
         WHERE (status = 'queued' AND updated_at < $3)
            OR (status = 'running' AND updated_at < $4)
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM expired`,
      [
        now,
        {
          code: 'job_expired',
          message: 'The review job expired before it completed.',
        },
        queuedCutoff,
        runningCutoff,
      ]
    );
    const deleted = await this.query<{ count: string }>(
      `WITH removed AS (
         DELETE FROM kawnix_review_jobs
         WHERE status IN ('completed', 'failed', 'cancelled', 'expired')
           AND updated_at < $1
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM removed`,
      [terminalCutoff]
    );
    return {
      expired: Number(expired.rows[0]?.count ?? 0),
      deleted: Number(deleted.rows[0]?.count ?? 0),
    };
  }

  async close() {
    await this.pool.end();
  }
}
