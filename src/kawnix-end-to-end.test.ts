import { createHash } from 'node:crypto';

import { handleKawnixProviderRequest } from './kawnix-provider';
import {
  createInMemoryKawnixJobHandlers,
  InMemoryKawnixJobStore,
  processNextKawnixJob,
} from './kawnix-jobs';
import {
  createKawnixRepositoryAuthorizer,
  parseKawnixRepositoryAccess,
} from './kawnix-authorization';
import { reviewPullRequest } from './kawnix-review';

const token = 'end-to-end-provider-token';
const repository = { owner: 'acme', name: 'service' };

const makeRequest = (body: unknown) =>
  new Request('https://provider.example.com/invoke', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

describe('Kawnix provider end-to-end workflow', () => {
  test('starts, executes, and polls an authorized report-only review', async () => {
    const ownerId = createHash('sha256').update(token).digest('hex');
    const access = parseKawnixRepositoryAccess(
      JSON.stringify({ [ownerId]: ['acme/service'] })
    );
    const store = new InMemoryKawnixJobStore();
    const handlers = createInMemoryKawnixJobHandlers(store, {
      authorizeRepository: createKawnixRepositoryAuthorizer(access),
    });

    const startResponse = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'start',
        repository,
        pull_request_number: 42,
        idempotency_key: 'review-42',
      }),
      { bearerToken: token, handlers }
    );
    expect(startResponse.status).toBe(202);
    const startBody = (await startResponse.json()) as {
      data: { job_id: string; status: string };
    };
    expect(startBody.data.status).toBe('queued');

    const processResult = await processNextKawnixJob(store, (input) =>
      reviewPullRequest({
        input,
        github: {
          listPullRequestFiles: async () => [
            {
              filename: 'src/service.ts',
              status: 'modified',
              patch: '@@ -1,1 +1,2 @@\n old\n+new',
            },
          ],
          createPullRequestReview: async () => ({ htmlUrl: undefined }),
        },
        chat: {
          codeReview: async () => ({
            lgtm: false,
            review_comment: 'Handle this error explicitly.',
            hunk_header: '@@ -1,1 +1,2 @@',
          }),
        },
      })
    );
    expect(processResult).toBe(true);

    const statusResponse = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'status',
        job_id: startBody.data.job_id,
      }),
      { bearerToken: token, handlers }
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        job_id: startBody.data.job_id,
        status: 'completed',
        result: {
          status: 'completed',
          lgtm: false,
          files_reviewed: 1,
          publication: {
            mode: 'report_only',
            published: false,
          },
        },
      },
    });
  });

  test('does not create a job for an unauthorized repository', async () => {
    const store = new InMemoryKawnixJobStore();
    const handlers = createInMemoryKawnixJobHandlers(store, {
      authorizeRepository: createKawnixRepositoryAuthorizer(new Map()),
    });

    const response = await handleKawnixProviderRequest(
      makeRequest({
        operation: 'start',
        repository,
        pull_request_number: 42,
      }),
      { bearerToken: token, handlers }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'repository_not_authorized' },
    });
    await expect(store.claimNextQueued()).resolves.toBeUndefined();
  });
});
