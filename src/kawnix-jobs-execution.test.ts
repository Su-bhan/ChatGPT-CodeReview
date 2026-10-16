import {
  InMemoryKawnixJobStore,
  runKawnixJob,
} from './kawnix-jobs.js';

const input = {
  operation: 'start' as const,
  repository: { owner: 'owner', name: 'repo' },
  pull_request_number: 3,
  publishing_mode: 'report_only' as const,
};

const job = {
  id: 'job_123',
  ownerId: 'owner_1',
  requestHash: 'hash',
  status: 'queued' as const,
  stage: 'queued' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  input,
};

describe('Kawnix job execution', () => {
  test('moves a job to completed and stores its result', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create(job);

    await runKawnixJob(storeJob(job), store, async () => ({
      status: 'completed',
      findings: [],
    }));

    await expect(store.get(job.id)).resolves.toMatchObject({
      status: 'completed',
      stage: 'completed',
      result: { status: 'completed', findings: [] },
    });
  });

  test('moves a job to failed and stores a safe failure', async () => {
    const store = new InMemoryKawnixJobStore();
    await store.create(job);

    await runKawnixJob(storeJob(job), store, async () => {
      throw new Error('GitHub unavailable');
    });

    await expect(store.get(job.id)).resolves.toMatchObject({
      status: 'failed',
      stage: 'failed',
      failure: {
        code: 'review_failed',
        message: 'GitHub unavailable',
      },
    });
  });
});

const storeJob = (value: typeof job) => value;
