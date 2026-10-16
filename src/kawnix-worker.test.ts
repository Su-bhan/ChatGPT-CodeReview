import {
  InMemoryKawnixJobStore,
  KawnixJobError,
  processNextKawnixJob,
  type KawnixJob,
} from './kawnix-jobs.js';
import { createInMemoryKawnixJobHandlers } from './kawnix-jobs.js';

const job: KawnixJob = {
  id: 'job_worker',
  ownerId: 'owner',
  requestHash: 'hash',
  status: 'queued',
  stage: 'queued',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  input: {
    repository: { owner: 'owner', name: 'repo' },
    pull_request_number: 1,
    publishing_mode: 'report_only',
  },
};

describe('Kawnix worker boundary', () => {
  test('claims and completes one queued job', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create(job);

    await expect(
      processNextKawnixJob(store, async () => ({ findings: [] }))
    ).resolves.toBe(true);
    await expect(store.get(job.id)).resolves.toMatchObject({
      status: 'completed',
      stage: 'completed',
      result: { findings: [] },
    });
  });

  test('returns false when there is no queued job', async () => {
    const store = new InMemoryKawnixJobStore();

    await expect(
      processNextKawnixJob(store, async () => ({ findings: [] }))
    ).resolves.toBe(false);
  });

  test('enforces per-owner concurrency limits', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create({
      ...job,
      id: 'job_running',
      status: 'running',
      stage: 'reviewing',
    });
    await store.create({
      ...job,
      id: 'job_queued',
      status: 'queued',
      stage: 'queued',
    });

    await expect(store.claimNextQueued()).resolves.toBeUndefined();
  });

  test('allows a different owner while one owner is running', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create({
      ...job,
      id: 'job_running',
      status: 'running',
      stage: 'reviewing',
    });
    await store.create({
      ...job,
      id: 'job_other_owner',
      ownerId: 'other-owner',
      status: 'queued',
      stage: 'queued',
    });

    await expect(store.claimNextQueued()).resolves.toMatchObject({
      id: 'job_other_owner',
      status: 'running',
    });
  });

  test('requeues a stale running job before claiming work', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create({
      ...job,
      status: 'running',
      stage: 'reviewing',
      updatedAt: new Date(Date.now() - 1_000).toISOString(),
    });

    const claimed = await store.claimNextQueued(500);

    expect(claimed).toMatchObject({
      id: job.id,
      status: 'running',
      stage: 'reviewing',
    });
  });

  test('requeues a transient failure until the attempt limit is reached', async () => {
      const store = new InMemoryKawnixJobStore();
      await store.create({ ...job, attempt: 1, maxAttempts: 2 });

      await expect(
        processNextKawnixJob(store, async () => {
          throw new KawnixJobError(503, 'upstream_unavailable', 'GitHub unavailable');
        })
      ).resolves.toBe(true);
      await expect(store.get(job.id)).resolves.toMatchObject({
        status: 'queued',
        attempt: 2,
        maxAttempts: 2,
      });
  });

  test('does not retry permanent failures', async () => {
      const store = new InMemoryKawnixJobStore();
      await store.create({ ...job, attempt: 1, maxAttempts: 3 });

      await processNextKawnixJob(store, async () => {
        throw new KawnixJobError(403, 'forbidden', 'Repository is not authorized');
      });
      await expect(store.get(job.id)).resolves.toMatchObject({
        status: 'failed',
        failure: { code: 'forbidden' },
        attempt: 1,
      });
  });

  test('converts an execution timeout into a terminal failure', async () => {
      const store = new InMemoryKawnixJobStore();
      await store.create({ ...job, attempt: 3, maxAttempts: 3 });

      await processNextKawnixJob(
        store,
        async () => new Promise(() => undefined),
        { timeoutMs: 5 }
      );
      await expect(store.get(job.id)).resolves.toMatchObject({
        status: 'failed',
        failure: { code: 'review_timeout', message: 'Review job timed out.' },
      });
  });

  test('expires abandoned jobs and deletes old terminal jobs', async () => {
      const store = new InMemoryKawnixJobStore();
      const now = new Date('2026-01-10T00:00:00.000Z');
      await store.create({
        ...job,
        id: 'job_stale_queued',
        status: 'queued',
        updatedAt: '2026-01-08T00:00:00.000Z',
      });
      await store.create({
        ...job,
        id: 'job_old_completed',
        status: 'completed',
        stage: 'completed',
        updatedAt: '2025-12-01T00:00:00.000Z',
      });

      await expect(
        store.cleanup({
          now,
          queuedTtlMs: 24 * 60 * 60 * 1000,
          terminalTtlMs: 7 * 24 * 60 * 60 * 1000,
        })
      ).resolves.toEqual({ expired: 1, deleted: 1 });
      await expect(store.get('job_stale_queued')).resolves.toMatchObject({
        status: 'expired',
        failure: { code: 'job_expired' },
      });
      await expect(store.get('job_old_completed')).resolves.toBeUndefined();
  });

  test('rejects a start request for an unauthorized repository', async () => {
    const store = new InMemoryKawnixJobStore();
    const handlers = createInMemoryKawnixJobHandlers(store, {
      authorizeRepository: async () => false,
    });
    const request = new Request('https://provider.example/invoke', {
      headers: { Authorization: 'Bearer consumer-token' },
    });

    await expect(
      handlers.start!(
        {
          operation: 'start',
          repository: { owner: 'owner', name: 'repo' },
          pull_request_number: 1,
        },
        request
      )
    ).rejects.toMatchObject({
      status: 403,
      code: 'repository_not_authorized',
    });
  });
});
