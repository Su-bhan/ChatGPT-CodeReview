import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

import type { KawnixJob, KawnixJobStore } from './kawnix-jobs.js';

type JobRow = QueryResultRow & {
  id: string;
  owner_id: string;
  request_hash: string;
  status: KawnixJob['status'];
  stage: KawnixJob['stage'];
  created_at: Date;
  updated_at: Date;
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
  input JSONB NOT NULL,
  result JSONB,
  failure JSONB,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS kawnix_review_jobs_owner_id_idx
  ON kawnix_review_jobs (owner_id);
`;

const toJob = (row: JobRow): KawnixJob => ({
  id: row.id,
  ownerId: row.owner_id,
  requestHash: row.request_hash,
  status: row.status,
  stage: row.stage,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  input: row.input,
  ...(row.result ? { result: row.result } : {}),
  ...(row.failure ? { failure: row.failure } : {}),
});

export class PostgresKawnixJobStore implements KawnixJobStore {
  private readonly pool: Pool;
  private ready: Promise<void> | undefined;

  constructor(config: PoolConfig | string) {
    this.pool = new Pool(
      typeof config === 'string' ? { connectionString: config } : config
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
        created_at, updated_at, input, result, failure)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        job.id,
        job.ownerId,
        job.input.idempotency_key ?? null,
        job.requestHash,
        job.status,
        job.stage,
        job.createdAt,
        job.updatedAt,
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
          created_at, updated_at, input, result, failure)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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

  async claimNextQueued(staleAfterMs = 15 * 60 * 1000) {
    await this.ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const staleBefore = new Date(Date.now() - staleAfterMs);
      await client.query(
        `UPDATE kawnix_review_jobs
         SET status = 'queued', stage = 'queued', updated_at = $1
         WHERE status = 'running' AND updated_at < $1`,
        [staleBefore]
      );
      const result = await client.query<JobRow>(
        `SELECT * FROM kawnix_review_jobs
         WHERE status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
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
       SET status = $2, stage = $3, updated_at = $4, input = $5,
           result = $6, failure = $7
       WHERE id = $1`,
      [
        job.id,
        job.status,
        job.stage,
        job.updatedAt,
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

  async close() {
    await this.pool.end();
  }
}
