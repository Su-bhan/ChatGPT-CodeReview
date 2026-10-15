import { type PoolConfig } from 'pg';
import { type KawnixCleanupOptions, type KawnixCleanupSummary, type KawnixJob, type KawnixJobStore } from './kawnix-jobs.js';
export declare class PostgresKawnixJobStore implements KawnixJobStore {
    private readonly pool;
    private ready;
    constructor(config: PoolConfig | string);
    private initialize;
    private query;
    private ensureReady;
    create(job: KawnixJob): Promise<void>;
    createOrGetByIdempotency(job: KawnixJob): Promise<KawnixJob | undefined>;
    get(jobId: string): Promise<KawnixJob | undefined>;
    claimNextQueued(staleAfterMs?: number, limits?: {
        readonly maxConcurrentPerOwner: 1;
        readonly maxConcurrentGlobal: 5;
    }): Promise<KawnixJob | undefined>;
    update(job: KawnixJob): Promise<void>;
    findByIdempotency(ownerId: string, idempotencyKey: string): Promise<KawnixJob | undefined>;
    cleanup(options?: KawnixCleanupOptions): Promise<KawnixCleanupSummary>;
    close(): Promise<void>;
}
