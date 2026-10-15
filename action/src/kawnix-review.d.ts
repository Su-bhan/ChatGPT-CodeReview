import { Chat } from './chat.js';
import type { KawnixStartInput } from './provider-contract.js';
export declare const KAWNIX_REVIEW_LIMITS: {
    readonly maxFiles: 100;
    readonly maxPatchBytesPerFile: 200000;
    readonly maxTotalPatchBytes: 1000000;
    readonly maxFindings: 100;
    readonly maxResultBytes: 256000;
};
export declare class KawnixReviewError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(status: number, code: string, message: string);
}
type GitHubPullRequestFile = {
    filename: string;
    status: string;
    patch?: string;
};
export type KawnixGitHubClient = {
    listPullRequestFiles: (owner: string, repository: string, pullRequestNumber: number) => Promise<GitHubPullRequestFile[]>;
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
    }) => Promise<{
        htmlUrl?: string;
    }>;
    listPullRequestReviews?: (owner: string, repository: string, pullRequestNumber: number) => Promise<Array<{
        body?: string;
        htmlUrl?: string;
    }>>;
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
export declare const reviewPullRequest: ({ input, github, chat, }: {
    input: KawnixStartInput;
    github: KawnixGitHubClient;
    chat: Pick<Chat, 'codeReview'>;
}) => Promise<KawnixReviewResult>;
export {};
