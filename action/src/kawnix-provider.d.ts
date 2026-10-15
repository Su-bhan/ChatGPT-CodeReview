import { type KawnixProviderInput } from './provider-contract.js';
export type KawnixProviderHandlers = {
    start?: (input: Extract<KawnixProviderInput, {
        operation: 'start';
    }>, request: Request) => Promise<Record<string, unknown>>;
    status?: (input: Extract<KawnixProviderInput, {
        operation: 'status';
    }>, request: Request) => Promise<Record<string, unknown>>;
    health?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};
export declare const handleKawnixProviderRequest: (request: Request, options: {
    bearerToken: string;
    handlers: KawnixProviderHandlers;
    maxRequestBytes?: number;
}) => Promise<Response>;
