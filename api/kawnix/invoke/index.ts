import { handleKawnixProviderRequest } from '../../../src/kawnix-provider.js';
import {
  createInMemoryKawnixJobHandlers,
  InMemoryKawnixJobStore,
} from '../../../src/kawnix-jobs.js';
import { PostgresKawnixJobStore } from '../../../src/postgres-kawnix-jobs.js';
import {
  createKawnixRepositoryAuthorizer,
  parseKawnixRepositoryAccess,
} from '../../../src/kawnix-authorization.js';
import { getKawnixConfigStatus } from '../../../src/kawnix-config.js';

export const config = {
  runtime: 'nodejs',
};

const jobStore = process.env.DATABASE_URL
  ? new PostgresKawnixJobStore(process.env.DATABASE_URL)
  : new InMemoryKawnixJobStore();
const repositoryAccess = createKawnixRepositoryAuthorizer(
  parseKawnixRepositoryAccess(process.env.KAWNIX_REPOSITORY_ACCESS)
);

export default async function handler(request: Request) {
  const bearerToken = process.env.KAWNIX_PROVIDER_TOKEN ?? '';
  const appId = process.env.APP_ID ?? '';
  const privateKey = process.env.PRIVATE_KEY ?? '';
  const geminiApiKey = process.env.GEMINI_API_KEY ?? '';
  const configStatus = getKawnixConfigStatus();
  const isConfigured = configStatus.productionReady;
  const hasExecutionConfig = Boolean(appId && privateKey && geminiApiKey);
  const handlers = createInMemoryKawnixJobHandlers(jobStore, {
    authorizeRepository: repositoryAccess,
  });

  return handleKawnixProviderRequest(request, {
    bearerToken,
    handlers: {
      ...handlers,
      health: () => ({
        status: isConfigured ? 'ready' : 'degraded',
        service: 'chatgpt-codereview',
        capabilities: {
          review_pull_request: hasExecutionConfig,
          publish_review: hasExecutionConfig,
          streaming: false,
        },
        configuration: {
          production_ready: configStatus.productionReady,
          missing: configStatus.missing,
        },
        message:
          isConfigured
            ? 'Provider is configured for review execution and durable persistence.'
            : hasExecutionConfig
              ? 'Review execution is configured, but DATABASE_URL is required for production.'
              : 'GitHub App and Gemini credentials are required for review execution.',
      }),
    },
  });
}
