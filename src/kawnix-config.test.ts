import { getKawnixConfigStatus, runKawnixPreflight } from './kawnix-config';

const completeEnvironment = {
  KAWNIX_PROVIDER_TOKEN: 'provider-token',
  KAWNIX_WORKER_TOKEN: 'worker-token',
  APP_ID: '123',
  PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----secret',
  GEMINI_API_KEY: 'gemini-key',
  DATABASE_URL: 'postgres://localhost/reviews',
  KAWNIX_REPOSITORY_ACCESS: '{"owner":["org/repo"]}',
};

describe('Kawnix deployment configuration', () => {
  test('reports production readiness without exposing secret values', () => {
    const status = getKawnixConfigStatus(completeEnvironment);

    expect(status).toMatchObject({
      productionReady: true,
      providerAuthentication: true,
      workerAuthentication: true,
      githubApp: true,
      gemini: true,
      database: true,
      repositoryAccess: true,
      missing: [],
    });
    expect(JSON.stringify(status)).not.toContain('gemini-key');
    expect(JSON.stringify(status)).not.toContain('provider-token');
  });

  test('reports all missing production requirements', () => {
    expect(getKawnixConfigStatus({})).toEqual({
      providerAuthentication: false,
      workerAuthentication: false,
      githubApp: false,
      gemini: false,
      database: false,
      repositoryAccess: false,
      productionReady: false,
      missing: [
        'KAWNIX_PROVIDER_TOKEN',
        'KAWNIX_WORKER_TOKEN',
        'APP_ID/PRIVATE_KEY',
        'GEMINI_API_KEY',
        'DATABASE_URL',
        'KAWNIX_REPOSITORY_ACCESS',
      ],
    });
  });

  test('rejects the example manifest until its placeholders are replaced', () => {
    const result = runKawnixPreflight({
      environment: completeEnvironment,
      manifest: {
        endpoint: { url: 'https://<provider-domain>/api/kawnix/invoke' },
      },
    });

    expect(result.ready).toBe(false);
    expect(result.checks.manifest.ok).toBe(false);
    expect(result.checks.publicUrl.ok).toBe(false);
  });

  test('accepts a complete HTTPS manifest with production configuration', () => {
    const result = runKawnixPreflight({
      environment: completeEnvironment,
      manifest: {
        endpoint: { url: 'https://reviews.example.com/api/kawnix/invoke' },
      },
    });

    expect(result).toEqual({
      ready: true,
      configuration: expect.objectContaining({ productionReady: true }),
      checks: {
        manifest: { ok: true, message: 'Manifest is complete.' },
        publicUrl: { ok: true, message: 'Manifest endpoint uses HTTPS.' },
      },
    });
  });
});
