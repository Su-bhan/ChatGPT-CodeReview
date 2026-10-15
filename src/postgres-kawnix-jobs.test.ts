import { PostgresKawnixJobStore } from './postgres-kawnix-jobs';
import { randomUUID } from 'node:crypto';
import type { KawnixJob } from './kawnix-jobs';

describe('PostgresKawnixJobStore', () => {
  test('is constructed from a database URL', () => {
    const store = new PostgresKawnixJobStore(
      'postgres://user:password@localhost:5432/reviews'
    );

    expect(store).toBeInstanceOf(PostgresKawnixJobStore);
  });
});

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDatabase('PostgresKawnixJobStore integration', () => {
  let store: PostgresKawnixJobStore;
  const ownerId = `integration-owner-${randomUUID()}`;

  beforeAll(() => {
    store = new PostgresKawnixJobStore(process.env.DATABASE_URL as string);
  });

  afterAll(async () => {
    await store.close();
  });

  test('persists, claims, updates, isolates, and cleans up a job', async () => {
    const now = new Date();
    const job: KawnixJob = {
      id: `integration-job-${randomUUID()}`,
      ownerId,
      requestHash: 'integration-hash',
      status: 'queued',
      stage: 'queued',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      attempt: 1,
      maxAttempts: 3,
      input: {
        repository: { owner: 'integration', name: 'repository' },
        pull_request_number: 1,
        publishing_mode: 'report_only',
        idempotency_key: `integration-key-${randomUUID()}`,
      },
    };

    await store.create(job);
    await expect(store.get(job.id)).resolves.toMatchObject({
      id: job.id,
      status: 'queued',
      ownerId,
    });

    const claimed = await store.claimNextQueued();
    expect(claimed).toMatchObject({
      id: job.id,
      status: 'running',
      stage: 'reviewing',
    });

    await store.update({
      ...claimed!,
      status: 'completed',
      stage: 'completed',
      updatedAt: new Date().toISOString(),
      result: { findings: [] },
    });
    await expect(store.get(job.id)).resolves.toMatchObject({
      status: 'completed',
      result: { findings: [] },
    });
    await expect(
      store.findByIdempotency(ownerId, job.input.idempotency_key!)
    ).resolves.toMatchObject({ id: job.id });
    await expect(
      store.findByIdempotency('different-owner', job.input.idempotency_key!)
    ).resolves.toBeUndefined();

    const cleanup = await store.cleanup({
      now: new Date(Date.now() + 1_000),
      terminalTtlMs: -1,
    });
    expect(cleanup.deleted).toBeGreaterThanOrEqual(1);
    await expect(store.get(job.id)).resolves.toBeUndefined();
  });
});
