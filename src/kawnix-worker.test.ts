import {
  InMemoryKawnixJobStore,
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
});
