import {
  InMemoryKawnixJobStore,
  KawnixJobError,
  processNextKawnixJob,
  type KawnixJob,
} from './kawnix-jobs';

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
});
