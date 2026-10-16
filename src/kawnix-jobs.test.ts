import {
  createInMemoryKawnixJobHandlers,
  InMemoryKawnixJobStore,
} from './kawnix-jobs.js';

const token = 'job-test-token';
const request = () =>
  new Request('https://provider.example.com/invoke', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

const startInput = {
  operation: 'start' as const,
  repository: { owner: 'owner', name: 'repo' },
  pull_request_number: 42,
  publishing_mode: 'report_only' as const,
};

describe('Kawnix job handlers', () => {
  test('creates a queued job and returns its identity', async () => {
    const handlers = createInMemoryKawnixJobHandlers(
      new InMemoryKawnixJobStore()
    );

    const result = await handlers.start?.(startInput, request());

    expect(result).toMatchObject({
      status: 'queued',
      stage: 'queued',
      repository: 'owner/repo',
      pull_request_number: 42,
    });
    expect(result?.job_id).toEqual(expect.stringContaining('job_'));
  });

  test('returns the same job for an identical idempotent request', async () => {
    const handlers = createInMemoryKawnixJobHandlers(
      new InMemoryKawnixJobStore()
    );
    const input = { ...startInput, idempotency_key: 'same-request' };

    const first = await handlers.start?.(input, request());
    const second = await handlers.start?.(input, request());

    expect(second?.job_id).toBe(first?.job_id);
  });

  test('rejects conflicting reuse of an idempotency key', async () => {
    const handlers = createInMemoryKawnixJobHandlers(
      new InMemoryKawnixJobStore()
    );
    const input = { ...startInput, idempotency_key: 'same-key' };

    await handlers.start?.(input, request());

    await expect(
      handlers.start?.(
        { ...input, pull_request_number: 43 },
        request()
      )
    ).rejects.toMatchObject({
      code: 'idempotency_conflict',
      status: 409,
    });
  });

  test('returns a job through status for its owner', async () => {
    const handlers = createInMemoryKawnixJobHandlers(
      new InMemoryKawnixJobStore()
    );
    const created = await handlers.start?.(startInput, request());

    const result = await handlers.status?.(
      { operation: 'status', job_id: String(created?.job_id) },
      request()
    );

    expect(result).toMatchObject({
      job_id: created?.job_id,
      status: 'queued',
    });
  });

  test('does not expose a job to a different owner', async () => {
    const handlers = createInMemoryKawnixJobHandlers(
      new InMemoryKawnixJobStore()
    );
    const created = await handlers.start?.(startInput, request());
    const otherRequest = () =>
      new Request('https://provider.example.com/invoke', {
        headers: { Authorization: 'Bearer different-token' },
      });

    await expect(
      handlers.status?.(
        { operation: 'status', job_id: String(created?.job_id) },
        otherRequest()
      )
    ).rejects.toMatchObject({
      code: 'job_not_found',
      status: 404,
    });
  });
});
