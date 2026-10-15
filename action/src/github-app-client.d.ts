import type { KawnixGitHubClient } from './kawnix-review.js';
type GitHubFetch = (input: string, init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
}) => Promise<Response>;
export declare class GitHubAppClientError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export type GitHubAppClientOptions = {
    appId: string;
    privateKey: string;
    apiBaseUrl?: string;
    fetchImpl?: GitHubFetch;
    installationToken?: string;
};
export declare const createGitHubAppClient: (options: GitHubAppClientOptions) => KawnixGitHubClient;
export {};
