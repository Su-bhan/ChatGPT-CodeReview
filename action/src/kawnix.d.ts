/// <reference types="node" />
export declare const KAWNIX_PROVIDER_ROUTE = "/api/kawnix/invoke";
export declare const KAWNIX_REPLAY_TTL_MS = 600000;
export declare const KAWNIX_MAX_BODY_BYTES: number;
export declare const KAWNIX_PROVIDER_MANIFEST: {
    readonly metadata: {
        readonly name: "ChatGPT Code Review";
        readonly version: "2.0.0";
        readonly description: "Review GitHub pull requests submitted through Kawnix.";
        readonly owner: "publisher";
    };
    readonly endpoint: {
        readonly method: "POST";
        readonly path: "/api/kawnix/invoke";
        readonly contentType: "application/json";
        readonly baseUrl: "https://<your-public-domain>";
        readonly timeoutMs: 30000;
        readonly auth: {
            readonly type: "bearer";
            readonly note: "The bearer token is stored and supplied by Kawnix.";
        };
    };
    readonly input: {
        readonly type: "object";
        readonly required: readonly ["operation"];
        readonly properties: {
            readonly operation: {
                readonly type: "string";
                readonly enum: readonly ["health", "start", "status"];
            };
            readonly repository: {
                readonly type: "object";
                readonly properties: {
                    readonly owner: {
                        readonly type: "string";
                        readonly maxLength: 100;
                    };
                    readonly name: {
                        readonly type: "string";
                        readonly maxLength: 100;
                    };
                };
                readonly required: readonly ["owner", "name"];
                readonly additionalProperties: false;
            };
            readonly pull_request_number: {
                readonly type: "integer";
                readonly minimum: 1;
            };
            readonly commit_sha: {
                readonly type: "string";
                readonly maxLength: 128;
            };
            readonly publishing_mode: {
                readonly type: "string";
                readonly enum: readonly ["report_only", "pull_request_review"];
                readonly default: "report_only";
            };
            readonly prompt: {
                readonly type: "string";
                readonly maxLength: 2000;
            };
            readonly include_patterns: {
                readonly type: "array";
                readonly maxItems: 100;
            };
            readonly ignore_patterns: {
                readonly type: "array";
                readonly maxItems: 100;
            };
            readonly idempotency_key: {
                readonly type: "string";
                readonly maxLength: 256;
            };
            readonly job_id: {
                readonly type: "string";
                readonly maxLength: 256;
            };
        };
        readonly additionalProperties: false;
    };
    readonly limits: {
        readonly maxFiles: 100;
        readonly maxPatchBytesPerFile: 200000;
        readonly maxTotalPatchBytes: 1000000;
        readonly maxFindings: 100;
        readonly maxResultBytes: 256000;
        readonly maxConcurrentPerOwner: 1;
        readonly maxConcurrentGlobal: 5;
    };
    readonly capabilities: {
        readonly sync: false;
        readonly streaming: false;
        readonly multipart: false;
        readonly customResponseMappings: false;
    };
    readonly auth: {
        readonly type: "bearer";
    };
    readonly pricing: {
        readonly model: "per_call";
        readonly requiresTokenCount: false;
        readonly note: "No token-metered billing is enabled for this provider endpoint.";
    };
    readonly successCriteria: {
        readonly statusCodes: readonly [200, 202];
        readonly responseBody: {
            readonly type: "object";
            readonly required: readonly ["success"];
            readonly properties: {
                readonly success: {
                    readonly type: "boolean";
                    readonly const: true;
                };
                readonly job_id: {
                    readonly type: "string";
                };
                readonly status: {
                    readonly type: "string";
                };
                readonly result: {
                    readonly type: "object";
                };
            };
            readonly additionalProperties: true;
        };
    };
};
export type KawnixProviderOperation = 'health' | 'review';
export type KawnixProviderInput = {
    operation: KawnixProviderOperation;
    prompt?: string;
    diff?: string;
    file?: string;
    repo?: string;
};
export type KawnixVerificationResult = {
    ok: true;
    method: string;
    url: URL;
    body: Buffer;
    input: KawnixProviderInput;
    keyId: string;
    nonce: string;
    requestId: string;
    endpointId: string;
    manifestId: string;
    subscriptionId: string;
} | {
    ok: false;
    status: number;
    code: string;
};
export declare const normalizeGatewayPathAndQuery: (url: URL) => string;
export declare const buildKawnixSignaturePayload: ({ version, timestamp, nonce, method, url, bodyHash, requestId, endpointId, manifestId, subscriptionId, }: {
    version: string;
    timestamp: number;
    nonce: string;
    method: string;
    url: URL;
    bodyHash: string;
    requestId: string;
    endpointId: string;
    manifestId: string;
    subscriptionId: string;
}) => string;
export declare const verifyKawnixSignature: ({ method, url, headers, body, secret, now, replayStoreRef, }: {
    method: string;
    url: URL;
    headers: Headers;
    body: Buffer;
    secret: string;
    now?: number | undefined;
    replayStoreRef?: Map<string, number> | undefined;
}) => KawnixVerificationResult;
export declare const executeProviderOperation: (input: KawnixProviderInput) => Record<string, unknown>;
export declare const handleKawnixRequest: (request: Request, options: {
    secret: string;
    agent?: ((input: KawnixProviderInput) => Promise<Record<string, unknown>> | Record<string, unknown>) | undefined;
}) => Promise<Response>;
