import type { KawnixProviderInput, KawnixStartInput } from './provider-contract.js';
import type { KawnixProviderHandlers } from './kawnix-provider.js';
import { type KawnixGitHubClient } from './kawnix-review.js';
import type { Chat } from './chat.js';
import type { KawnixRepositoryAuthorizer } from './kawnix-authorization.js';
export declare const KAWNIX_CONCURRENCY_LIMITS: {
    readonly maxConcurrentPerOwner: 1;
    readonly maxConcurrentGlobal: 5;
};
export declare const KAWNIX_RETENTION_DEFAULTS: {
    readonly queuedTtlMs: number;
    readonly runningTtlMs: number;
    readonly terminalTtlMs: number;
};
export type KawnixCleanupOptions = {
    now?: Date;
    queuedTtlMs?: number;
    runningTtlMs?: number;
    terminalTtlMs?: number;
};
export type KawnixCleanupSummary = {
    expired: number;
    deleted: number;
};
export type KawnixJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type KawnixJob = {
    id: string;
    ownerId: string;
    requestHash: string;
    status: KawnixJobStatus;
    stage: 'queued' | 'reviewing' | 'publishing' | 'completed' | 'failed';
    createdAt: string;
    updatedAt: string;
    attempt?: number;
    maxAttempts?: number;
    input: Omit<KawnixStartInput, 'operation'>;
    result?: Record<string, unknown>;
    failure?: {
        code: string;
        message: string;
    };
};
export type KawnixJobStore = {
    create(job: KawnixJob): Promise<void>;
    createOrGetByIdempotency?(job: KawnixJob): Promise<KawnixJob | undefined>;
    get(jobId: string): Promise<KawnixJob | undefined>;
    claimNextQueued(staleAfterMs?: number, limits?: typeof KAWNIX_CONCURRENCY_LIMITS): Promise<KawnixJob | undefined>;
    update(job: KawnixJob): Promise<void>;
    findByIdempotency(ownerId: string, idempotencyKey: string): Promise<KawnixJob | undefined>;
    cleanup(options?: KawnixCleanupOptions): Promise<KawnixCleanupSummary>;
};
export declare class InMemoryKawnixJobStore implements KawnixJobStore {
    private readonly jobs;
    create(job: KawnixJob): Promise<void>;
    get(jobId: string): Promise<KawnixJob | undefined>;
    claimNextQueued(staleAfterMs?: number, limits?: {
        readonly maxConcurrentPerOwner: 1;
        readonly maxConcurrentGlobal: 5;
    }): Promise<{
        status: "running";
        stage: "reviewing";
        updatedAt: string;
        id: string;
        ownerId: string;
        requestHash: string;
        createdAt: string;
        attempt?: number | undefined;
        maxAttempts?: number | undefined;
        input: Omit<KawnixStartInput, "operation">;
        result?: Record<string, unknown> | undefined;
        failure?: {
            code: string;
            message: string;
        } | undefined;
    } | undefined>;
    update(job: KawnixJob): Promise<void>;
    findByIdempotency(ownerId: string, idempotencyKey: string): Promise<KawnixJob | undefined>;
    cleanup(options?: KawnixCleanupOptions): Promise<KawnixCleanupSummary>;
}
export declare const createInMemoryKawnixJobHandlers: (store: KawnixJobStore, options?: {
    authorizeRepository?: KawnixRepositoryAuthorizer;
}) => KawnixProviderHandlers;
export declare const runKawnixJob: (job: KawnixJob, store: KawnixJobStore, execute: (input: KawnixStartInput) => Promise<Record<string, unknown>>) => Promise<void>;
export declare const processNextKawnixJob: (store: KawnixJobStore, execute: (input: KawnixStartInput) => Promise<Record<string, unknown>>, options?: {
    maxAttempts?: number;
    timeoutMs?: number;
    authorizeRepository?: KawnixRepositoryAuthorizer;
}) => Promise<boolean>;
export declare const createReviewJobExecutor: ({ github, chat, }: {
    github: KawnixGitHubClient;
    chat: Pick<Chat, 'codeReview'>;
}) => (input: KawnixStartInput) => Promise<Record<string, unknown>>;
export declare class KawnixJobError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare const getProviderOwnerId: (request: Request) => string;
export declare const getJobInput: (job: KawnixJob) => Extract<KawnixProviderInput, {
    operation: 'start';
}>;
