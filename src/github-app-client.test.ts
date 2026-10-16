import { createGitHubAppClient } from './github-app-client.js';
import { generateKeyPairSync } from 'node:crypto';
import { reviewPullRequest } from './kawnix-review.js';

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

  test('supports review lookup and prevents duplicate publication through the adapter', async () => {
      const reviews: Array<{ body: string; html_url: string }> = [];
      const calls: Array<{ url: string; method: string }> = [];
      const fetchImpl = jest.fn(async (url, init) => {
        calls.push({ url, method: init.method });
        if (url.endsWith('/installation')) {
          return new Response(JSON.stringify({ id: 42 }), { status: 200 });
        }
        if (url.endsWith('/access_tokens')) {
          return new Response(JSON.stringify({ token: 'installation-token' }), {
            status: 201,
          });
        }
        if (url.includes('/files')) {
          return new Response(
            JSON.stringify([
              {
                filename: 'src/example.ts',
                status: 'modified',
                patch: '@@ -1,1 +1,2 @@\n old\n+new',
              },
            ]),
            { status: 200 }
          );
        }
        if (url.includes('/reviews') && init.method === 'GET') {
          return new Response(JSON.stringify(reviews), { status: 200 });
        }
        if (url.includes('/reviews') && init.method === 'POST') {
          const body = JSON.parse(init.body ?? '{}') as { body: string };
          const review = {
            body: body.body,
            html_url: 'https://github.com/owner/repo/pull/7#review',
          };
          reviews.push(review);
          return new Response(JSON.stringify(review), { status: 200 });
        }
        throw new Error(`Unexpected GitHub request: ${url}`);
      });
      const github = createGitHubAppClient({
        appId: '123',
        privateKey,
        fetchImpl,
      });
      const input = {
        operation: 'start' as const,
        repository: { owner: 'owner', name: 'repo' },
        pull_request_number: 7,
        publishing_mode: 'pull_request_review' as const,
      };
      const chat = {
        codeReview: jest.fn(async () => ({
          lgtm: false,
          review_comment: 'Fix this.',
          hunk_header: '@@ -1,1 +1,2 @@',
        })),
      };

      const first = await reviewPullRequest({ input, github, chat });
      const second = await reviewPullRequest({ input, github, chat });

      expect(first.publication.published).toBe(true);
      expect(second.publication).toEqual(first.publication);
      expect(
        calls.filter(
          (call) => call.url.includes('/reviews') && call.method === 'POST'
        )
      ).toHaveLength(1);
      expect(
        calls.filter((call) => call.url.endsWith('/access_tokens'))
      ).toHaveLength(1);
  });
});
