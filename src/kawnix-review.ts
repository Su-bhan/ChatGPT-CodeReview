import { minimatch } from 'minimatch';
import { createHash } from 'node:crypto';

import {
  createInlineReviewComment,
  createReviewBody,
} from './bot.js';
import { Chat } from './chat.js';
import type { KawnixStartInput } from './provider-contract.js';

export const KAWNIX_REVIEW_LIMITS = {
  maxFiles: 100,
  maxPatchBytesPerFile: 200_000,
  maxTotalPatchBytes: 1_000_000,
  maxFindings: 100,
  maxResultBytes: 256_000,
} as const;

export class KawnixReviewError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'KawnixReviewError';
    this.status = status;
    this.code = code;
  }
}

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
  listPullRequestReviews?: (
    owner: string,
    repository: string,
    pullRequestNumber: number
  ) => Promise<Array<{ body?: string; htmlUrl?: string }>>;
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

const getPublicationMarker = (input: KawnixStartInput) =>
  `<!-- kawnix-review:${createHash('sha256')
    .update(
      JSON.stringify({
        repository: input.repository,
        pull_request_number: input.pull_request_number,
        commit_sha: input.commit_sha,
        prompt: input.prompt,
        include_patterns: input.include_patterns,
        ignore_patterns: input.ignore_patterns,
      })
    )
    .digest('hex')} -->`;

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
  if (files.length > KAWNIX_REVIEW_LIMITS.maxFiles) {
    throw new KawnixReviewError(
      413,
      'review_file_limit_exceeded',
      `Pull request contains more than ${KAWNIX_REVIEW_LIMITS.maxFiles} files.`
    );
  }
  const filesToReview = files.filter((file) => shouldReviewFile(file, input));
  const totalPatchBytes = filesToReview.reduce(
    (total, file) => total + Buffer.byteLength(file.patch ?? '', 'utf8'),
    0
  );
  const oversizedFile = filesToReview.find(
    (file) =>
      Buffer.byteLength(file.patch ?? '', 'utf8') >
      KAWNIX_REVIEW_LIMITS.maxPatchBytesPerFile
  );
  if (oversizedFile) {
    throw new KawnixReviewError(
      413,
      'review_patch_limit_exceeded',
      `Patch for ${oversizedFile.filename} exceeds the per-file review limit.`
    );
  }
  if (totalPatchBytes > KAWNIX_REVIEW_LIMITS.maxTotalPatchBytes) {
    throw new KawnixReviewError(
      413,
      'review_patch_limit_exceeded',
      'The pull request exceeds the total review patch limit.'
    );
  }
  const findings: KawnixReviewFinding[] = [];
  const bodyComments: string[] = [];

  for (const file of filesToReview) {
    const patch = file.patch ?? '';
    const result = await chat.codeReview(patch);

    for (const review of asReviews(result as ReviewResponse | ReviewResponse[])) {
      if (review.lgtm || !review.review_comment) {
        continue;
      }
      if (findings.length >= KAWNIX_REVIEW_LIMITS.maxFindings) {
        throw new KawnixReviewError(
          413,
          'review_finding_limit_exceeded',
          `Review produced more than ${KAWNIX_REVIEW_LIMITS.maxFindings} findings.`
        );
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

  const result = {
    status: 'completed' as const,
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
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > KAWNIX_REVIEW_LIMITS.maxResultBytes) {
    throw new KawnixReviewError(
      413,
      'review_result_limit_exceeded',
      'The generated review result exceeds the result size limit.'
    );
  }

  if (publication.mode === 'pull_request_review') {
    const marker = getPublicationMarker(input);
    if (github.listPullRequestReviews) {
      const existingReviews = await github.listPullRequestReviews(
        input.repository.owner,
        input.repository.name,
        input.pull_request_number
      );
      const existingReview = existingReviews.find((review) =>
        review.body?.includes(marker)
      );
      if (existingReview) {
        publication.published = true;
        publication.url = existingReview.htmlUrl;
        return result;
      }
    }
    const review = await github.createPullRequestReview({
      owner: input.repository.owner,
      repository: input.repository.name,
      pullRequestNumber: input.pull_request_number,
      commitSha: input.commit_sha,
      body: `${createReviewBody(
        findings.some((finding) => finding.line !== undefined),
        bodyComments
      )}\n\n${marker}`,
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

  return result;
};
