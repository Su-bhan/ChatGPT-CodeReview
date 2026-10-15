export declare const KAWNIX_INVOKE_ROUTE = "/invoke";
export declare const KAWNIX_MAX_REQUEST_BYTES: number;
export declare const KAWNIX_MAX_PROMPT_LENGTH = 2000;
export declare const KAWNIX_MAX_PATTERN_COUNT = 100;
export declare const KAWNIX_MAX_PATTERN_LENGTH = 256;
export declare const KAWNIX_OPERATIONS: readonly ["health", "start", "status"];
export declare const KAWNIX_PUBLISHING_MODES: readonly ["report_only", "pull_request_review"];
export type KawnixOperation = (typeof KAWNIX_OPERATIONS)[number];
export type KawnixPublishingMode = (typeof KAWNIX_PUBLISHING_MODES)[number];
export type KawnixRepository = {
    owner: string;
    name: string;
};
export type KawnixStartInput = {
    operation: 'start';
    repository: KawnixRepository;
    pull_request_number: number;
    commit_sha?: string;
    publishing_mode?: KawnixPublishingMode;
    prompt?: string;
    include_patterns?: string[];
    ignore_patterns?: string[];
    idempotency_key?: string;
};
export type KawnixStatusInput = {
    operation: 'status';
    job_id: string;
};
export type KawnixHealthInput = {
    operation: 'health';
};
export type KawnixProviderInput = KawnixHealthInput | KawnixStartInput | KawnixStatusInput;
export type KawnixValidationError = {
    code: string;
    message: string;
};
export type KawnixValidationResult = {
    ok: true;
    input: KawnixProviderInput;
} | {
    ok: false;
    error: KawnixValidationError;
};
export declare const validateKawnixInput: (value: unknown) => KawnixValidationResult;
