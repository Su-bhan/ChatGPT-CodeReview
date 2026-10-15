import {
  KAWNIX_REVIEW_LIMITS,
  reviewPullRequest,
} from './kawnix-review';

const input = {
  operation: 'start' as const,
  repository: { owner: 'owner', name: 'repo' },
  pull_request_number: 7,
  publishing_mode: 'report_only' as const,
  ignore_patterns: ['**/*.md'],
};

const patch = '@@ -1,1 +1,2 @@\n old\n+new';

describe('Kawnix pull-request review service', () => {
  test('reviews eligible files and returns structured findings', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () => [
        { filename: 'src/example.ts', status: 'modified', patch },
        { filename: 'README.md', status: 'modified', patch },
        { filename: 'image.png', status: 'renamed', patch },
      ]),
      createPullRequestReview: jest.fn(),
    };
    const chat = {
      codeReview: jest.fn(async () => ({
        lgtm: false,
        hunk_header: '@@ -1,1 +1,2 @@',
        review_comment: 'This needs attention.',
      })),
    };

    const result = await reviewPullRequest({ input, github, chat });

    expect(result).toMatchObject({
      status: 'completed',
      lgtm: false,
      files_reviewed: 1,
      files_skipped: 2,
      findings: [
        {
          file: 'src/example.ts',
          comment: 'This needs attention.',
          line: 2,
          side: 'RIGHT',
        },
      ],
      publication: { mode: 'report_only', published: false },
    });
    expect(github.createPullRequestReview).not.toHaveBeenCalled();
  });

  test('applies include and ignore patterns', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () => [
        { filename: 'src/example.ts', status: 'modified', patch },
        { filename: 'src/generated.ts', status: 'modified', patch },
      ]),
      createPullRequestReview: jest.fn(),
    };
    const chat = {
      codeReview: jest.fn(async () => ({
        lgtm: true,
        review_comment: '',
      })),
    };

    const result = await reviewPullRequest({
      input: {
        ...input,
        include_patterns: ['src/**/*.ts'],
        ignore_patterns: ['**/generated.ts'],
      },
      github,
      chat,
    });

    expect(result.files_reviewed).toBe(1);
    expect(chat.codeReview).toHaveBeenCalledTimes(1);
  });

  test('publishes inline findings when requested', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () => [
        { filename: 'src/example.ts', status: 'modified', patch },
      ]),
      createPullRequestReview: jest.fn(async () => ({
        htmlUrl: 'https://github.com/owner/repo/pull/7#review',
      })),
    };
    const chat = {
      codeReview: jest.fn(async () => ({
        lgtm: false,
        hunk_header: '@@ -1,1 +1,2 @@',
        review_comment: 'Fix this.',
      })),
    };

    const result = await reviewPullRequest({
      input: { ...input, publishing_mode: 'pull_request_review' },
      github,
      chat,
    });

    expect(result.publication).toEqual({
      mode: 'pull_request_review',
      published: true,
      url: 'https://github.com/owner/repo/pull/7#review',
    });
    expect(github.createPullRequestReview).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repository: 'repo',
        pullRequestNumber: 7,
        commitSha: undefined,
        comments: [
          {
            path: 'src/example.ts',
            body: 'Fix this.',
            line: 2,
            side: 'RIGHT',
          },
        ],
      })
    );
  });

  test('rejects pull requests with too many files', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () =>
        Array.from({ length: KAWNIX_REVIEW_LIMITS.maxFiles + 1 }, (_, index) => ({
          filename: `src/file-${index}.ts`,
          status: 'modified',
          patch,
        }))
      ),
      createPullRequestReview: jest.fn(),
    };

    await expect(
      reviewPullRequest({
        input,
        github,
        chat: { codeReview: jest.fn() },
      })
    ).rejects.toMatchObject({
      status: 413,
      code: 'review_file_limit_exceeded',
    });
  });

  test('rejects an oversized patch before calling Gemini', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () => [
        {
          filename: 'src/large.ts',
          status: 'modified',
          patch: 'x'.repeat(KAWNIX_REVIEW_LIMITS.maxPatchBytesPerFile + 1),
        },
      ]),
      createPullRequestReview: jest.fn(),
    };
    const chat = { codeReview: jest.fn() };

    await expect(reviewPullRequest({ input, github, chat })).rejects.toMatchObject({
      status: 413,
      code: 'review_patch_limit_exceeded',
    });
    expect(chat.codeReview).not.toHaveBeenCalled();
  });

  test('rejects a result with too many findings', async () => {
    const github = {
      listPullRequestFiles: jest.fn(async () => [
        { filename: 'src/example.ts', status: 'modified', patch },
      ]),
      createPullRequestReview: jest.fn(),
    };
    const chat = {
      codeReview: jest.fn(async () =>
        Array.from({ length: KAWNIX_REVIEW_LIMITS.maxFindings + 1 }, () => ({
          lgtm: false,
          review_comment: 'This needs attention.',
        }))
      ),
    };

    await expect(reviewPullRequest({ input, github, chat })).rejects.toMatchObject({
      status: 413,
      code: 'review_finding_limit_exceeded',
    });
  });
});
