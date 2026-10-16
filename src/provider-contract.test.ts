import {
  KAWNIX_INVOKE_ROUTE,
  validateKawnixInput,
} from './provider-contract.js';

describe('Kawnix provider contract', () => {
  test('uses the canonical provider route', () => {
    expect(KAWNIX_INVOKE_ROUTE).toBe('/invoke');
  });

  test('accepts a health request', () => {
    expect(validateKawnixInput({ operation: 'health' })).toEqual({
      ok: true,
      input: { operation: 'health' },
    });
  });

  test('accepts a start request with safe defaults', () => {
    expect(
      validateKawnixInput({
        operation: 'start',
        repository: { owner: 'example-owner', name: 'example-repository' },
        pull_request_number: 12,
      })
    ).toEqual({
      ok: true,
      input: {
        operation: 'start',
        repository: {
          owner: 'example-owner',
          name: 'example-repository',
        },
        pull_request_number: 12,
        publishing_mode: 'report_only',
      },
    });
  });

  test('accepts a status request', () => {
    expect(validateKawnixInput({ operation: 'status', job_id: 'job-123' })).toEqual({
      ok: true,
      input: { operation: 'status', job_id: 'job-123' },
    });
  });

  test('rejects a repository URL instead of owner and name', () => {
    expect(
      validateKawnixInput({
        operation: 'start',
        repository: 'https://github.com/example-owner/example-repository',
        pull_request_number: 12,
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });

  test('rejects publication modes that are not declared', () => {
    expect(
      validateKawnixInput({
        operation: 'start',
        repository: { owner: 'example-owner', name: 'example-repository' },
        pull_request_number: 12,
        publishing_mode: 'push_to_main',
      })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });

  test('rejects additional health fields', () => {
    expect(
      validateKawnixInput({ operation: 'health', repository: 'unexpected' })
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });
});
