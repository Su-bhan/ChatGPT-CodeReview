import { createGitHubAppClient } from './github-app-client';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

describe('GitHub App client', () => {
  test('retrieves installation access and pull-request files', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = jest.fn(async (url, init) => {
      calls.push({ url, method: init.method, body: init.body });
      if (url.endsWith('/installation')) {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      if (url.endsWith('/access_tokens')) {
        return new Response(
          JSON.stringify({
            token: 'installation-token',
            expires_at: new Date(Date.now() + 300_000).toISOString(),
          }),
          { status: 201 }
        );
      }
      return new Response(
        JSON.stringify([
          {
            filename: 'src/example.ts',
            status: 'modified',
            patch: '@@ -1 +1 @@\n-old\n+new',
          },
        ]),
        { status: 200 }
      );
    });
    const client = createGitHubAppClient({
      appId: '123',
      privateKey,
      fetchImpl,
    });

    const files = await client.listPullRequestFiles('owner', 'repo', 7);

    expect(files).toEqual([
      {
        filename: 'src/example.ts',
        status: 'modified',
        patch: '@@ -1 +1 @@\n-old\n+new',
      },
    ]);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST', 'GET']);
    expect(calls[2].url).toContain('/pulls/7/files');
  });

  test('publishes a pull-request review using the installation token', async () => {
    const fetchImpl = jest.fn(async (url, _init) => {
      if (url.endsWith('/installation')) {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'installation-token' }), {
          status: 201,
        });
      }
      return new Response(
        JSON.stringify({ html_url: 'https://github.com/owner/repo/pull/7#review' }),
        { status: 200 }
      );
    });
    const client = createGitHubAppClient({
      appId: '123',
      privateKey,
      fetchImpl,
    });

    await expect(
      client.createPullRequestReview({
        owner: 'owner',
        repository: 'repo',
        pullRequestNumber: 7,
        commitSha: 'abc',
        body: 'Review',
        comments: [],
      })
    ).resolves.toEqual({
      htmlUrl: 'https://github.com/owner/repo/pull/7#review',
    });

    const reviewCall = fetchImpl.mock.calls[2];
    expect(reviewCall[1].method).toBe('POST');
    expect(JSON.parse(reviewCall[1].body ?? '')).toMatchObject({
      body: 'Review',
      event: 'COMMENT',
      commit_id: 'abc',
      comments: [],
    });
  });
});
