import type { KawnixRepository } from './provider-contract.js';
export type KawnixRepositoryAuthorizer = (ownerId: string, repository: KawnixRepository) => boolean | Promise<boolean>;
export declare const parseKawnixRepositoryAccess: (value: string | undefined) => Map<string, Set<string>>;
export declare const createKawnixRepositoryAuthorizer: (access: Map<string, Set<string>>) => KawnixRepositoryAuthorizer;
