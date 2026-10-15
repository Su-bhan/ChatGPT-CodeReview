import { minimatch } from 'minimatch';

import {
  createInlineReviewComment,
  createReviewBody,
} from './bot.js';
import { Chat } from './chat.js';
import type { KawnixStartInput } from './provider-contract.js';

type GitHubPullRequestFile = {
  filename: string;
  status: string;
  patch?: string;
};

export type KawnixGitHubClient = {
  listPullRequestFiles: (
    owner: string,
    repository: string,
    pullRequestNumber: number
  ) => Promise<GitHubPullRequestFile[]>;
  createPullRequestReview: (input: {
    owner: string;
    repository: string;
    pullRequestNumber: number;
    commitSha?: string;
    body: string;
    comments: Array<{
      path: string;
      body: string;
      line: number;
      side: 'LEFT' | 'RIGHT';
    }>;
  }) => Promise<{ htmlUrl?: string }>;
};

type ReviewResponse = {
  lgtm: boolean;
  review_comment: string;
  hunk_header?: string;
};

export type KawnixReviewFinding = {
  file: string;
  comment: string;
  hunk_header?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
};

export type KawnixReviewResult = {
  status: 'completed';
  lgtm: boolean;
  summary: string;
  findings: KawnixReviewFinding[];
  files_reviewed: number;
  files_skipped: number;
  publication: {
    mode: 'report_only' | 'pull_request_review';
    published: boolean;
    url?: string;
  };
};

const matchesPattern = (patterns: string[], path: string) =>
  patterns.some((pattern) => {
    try {
      return minimatch(path, pattern);
    } catch {
      return false;
    }
  });

const shouldReviewFile = (
  file: GitHubPullRequestFile,
  input: KawnixStartInput
) => {
  if (file.status !== 'modified' && file.status !== 'added') {
    return false;
  }

  if (!file.patch) {
    return false;
  }

  if (
    input.include_patterns?.length &&
    !matchesPattern(input.include_patterns, file.filename)
  ) {
    return false;
  }

  if (
    input.ignore_patterns?.length &&
    matchesPattern(input.ignore_patterns, file.filename)
  ) {
    return false;
  }

  return true;
};

const asReviews = (value: ReviewResponse | ReviewResponse[]) =>
  Array.isArray(value) ? value : [value];

export const reviewPullRequest = async ({
  input,
  github,
  chat,
}: {
  input: KawnixStartInput;
  github: KawnixGitHubClient;
  chat: Pick<Chat, 'codeReview'>;
}): Promise<KawnixReviewResult> => {
  const files = await github.listPullRequestFiles(
    input.repository.owner,
    input.repository.name,
    input.pull_request_number
  );
  const filesToReview = files.filter((file) => shouldReviewFile(file, input));
  const findings: KawnixReviewFinding[] = [];
  const bodyComments: string[] = [];

  for (const file of filesToReview) {
    const patch = file.patch ?? '';
    const result = await chat.codeReview(patch);

    for (const review of asReviews(result as ReviewResponse | ReviewResponse[])) {
      if (review.lgtm || !review.review_comment) {
        continue;
      }

      const inlineComment = createInlineReviewComment(
        file.filename,
        review.review_comment,
        review.hunk_header,
        patch
      );
      if (inlineComment) {
        findings.push({
          file: file.filename,
          comment: review.review_comment,
          hunk_header: review.hunk_header,
          line: inlineComment.line,
          side: inlineComment.side,
        });
      } else {
        findings.push({
          file: file.filename,
          comment: review.review_comment,
          hunk_header: review.hunk_header,
        });
        bodyComments.push(
          `**File:** \`${file.filename.replace(/`/g, '\\`')}\`\n\n${review.review_comment}`
        );
      }
    }
  }

  const publication = {
    mode: input.publishing_mode ?? 'report_only',
    published: false,
  } as KawnixReviewResult['publication'];

  if (publication.mode === 'pull_request_review') {
    const review = await github.createPullRequestReview({
      owner: input.repository.owner,
      repository: input.repository.name,
      pullRequestNumber: input.pull_request_number,
      commitSha: input.commit_sha,
      body: createReviewBody(
        findings.some((finding) => finding.line !== undefined),
        bodyComments
      ),
      comments: findings
        .filter(
          (
            finding
          ): finding is KawnixReviewFinding & {
            line: number;
            side: 'LEFT' | 'RIGHT';
          } =>
            finding.line !== undefined && finding.side !== undefined
        )
        .map((finding) => ({
          path: finding.file,
          body: finding.comment,
          line: finding.line,
          side: finding.side,
        })),
    });
    publication.published = true;
    publication.url = review.htmlUrl;
  }

  return {
    status: 'completed',
    lgtm: findings.length === 0,
    summary:
      findings.length === 0
        ? 'No review findings were identified.'
        : `${findings.length} review finding${findings.length === 1 ? '' : 's'} identified.`,
    findings,
    files_reviewed: filesToReview.length,
    files_skipped: files.length - filesToReview.length,
    publication,
  };
};
