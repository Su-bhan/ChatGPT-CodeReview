export type KawnixConfigEnvironment = Record<string, string | undefined>;
export type KawnixConfigStatus = {
    providerAuthentication: boolean;
    workerAuthentication: boolean;
    githubApp: boolean;
    gemini: boolean;
    database: boolean;
    repositoryAccess: boolean;
    productionReady: boolean;
    missing: string[];
};
export type KawnixPreflightResult = {
    ready: boolean;
    configuration: KawnixConfigStatus;
    checks: {
        manifest: {
            ok: boolean;
            message: string;
        };
        publicUrl: {
            ok: boolean;
            message: string;
        };
    };
};
export declare const getKawnixConfigStatus: (environment?: KawnixConfigEnvironment) => KawnixConfigStatus;
export declare const runKawnixPreflight: ({ environment, manifest, }: {
    environment?: KawnixConfigEnvironment | undefined;
    manifest: unknown;
}) => KawnixPreflightResult;
