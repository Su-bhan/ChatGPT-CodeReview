import { handleKawnixProviderRequest } from './kawnix-provider.js';

const token = 'provider-test-token';

const makeRequest = (body: unknown, init: RequestInit = {}) =>
  new Request('https://provider.example.com/invoke', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    ...init,
  });

const handlers = {
  start: jest.fn(async () => ({ job_id: 'job-123', status: 'queued' })),
  status: jest.fn(async () => ({ job_id: 'job-123', status: 'completed' })),
};

describe('Kawnix provider transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns readiness for an authenticated health request', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({ operation: 'health' }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      success: true,
      data: {
        status: 'ready',
        service: 'chatgpt-codereview',
      },
    });
  });

  test('dispatches start and returns accepted', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'start',
        repository: { owner: 'owner', name: 'repo' },
        pull_request_number: 10,
      }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(202);
    expect(handlers.start).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'start',
        publishing_mode: 'report_only',
      }),
      expect.any(Request)
    );
  });

  test('dispatches status', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({ operation: 'status', job_id: 'job-123' }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(200);
    expect(handlers.status).toHaveBeenCalledTimes(1);
  });

  test('rejects missing or invalid authentication before dispatch', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({ operation: 'health' }, {
        headers: { 'Content-Type': 'application/json' },
      }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(401);
    expect(handlers.start).not.toHaveBeenCalled();
    expect(handlers.status).not.toHaveBeenCalled();
  });

  test('rejects non-JSON requests', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest('not-json', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'text/plain',
        },
      }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(415);
  });

  test('rejects malformed input without invoking handlers', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'start',
        repository: 'https://github.com/owner/repo',
        pull_request_number: 10,
      }),
      { bearerToken: token, handlers }
    );

    expect(result.status).toBe(400);
    expect(handlers.start).not.toHaveBeenCalled();
  });

  test('rejects oversized requests', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({ operation: 'health' }),
      { bearerToken: token, handlers, maxRequestBytes: 1 }
    );

    expect(result.status).toBe(413);
  });

  test('converts unexpected start failures to a safe provider error', async () => {
    const result = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'start',
        repository: { owner: 'owner', name: 'repo' },
        pull_request_number: 10,
      }),
      {
        bearerToken: token,
        handlers: {
          start: async () => {
            throw new Error('database password must not leak');
          },
        },
      }
    );

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'internal_error',
        message: 'The provider could not create the review job.',
      },
    });
  });
});
