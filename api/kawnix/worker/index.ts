import {
  createReviewJobExecutor,
  processNextKawnixJob,
} from '../../../src/kawnix-jobs.js';
import { Chat } from '../../../src/chat.js';
import { createGitHubAppClient } from '../../../src/github-app-client.js';
import { PostgresKawnixJobStore } from '../../../src/postgres-kawnix-jobs.js';

export const config = {
  runtime: 'nodejs18.x',
};

const jobStore = process.env.DATABASE_URL
  ? new PostgresKawnixJobStore(process.env.DATABASE_URL)
  : undefined;

export default async function handler(request: Request) {
  const workerToken = process.env.KAWNIX_WORKER_TOKEN ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  const suppliedToken = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!workerToken) {
    return Response.json(
      { success: false, error: { code: 'missing_worker_token' } },
      { status: 500 }
    );
  }
  if (request.method !== 'POST' || suppliedToken !== workerToken) {
    return Response.json(
      { success: false, error: { code: 'invalid_worker_authentication' } },
      { status: 401 }
    );
  }
  if (!jobStore) {
    return Response.json(
      { success: false, error: { code: 'missing_database' } },
      { status: 503 }
    );
  }

  const appId = process.env.APP_ID ?? '';
  const privateKey = process.env.PRIVATE_KEY ?? '';
  const geminiApiKey = process.env.GEMINI_API_KEY ?? '';
  if (!appId || !privateKey || !geminiApiKey) {
    return Response.json(
      { success: false, error: { code: 'missing_execution_configuration' } },
      { status: 503 }
    );
  }

  const processed = await processNextKawnixJob(
    jobStore,
    createReviewJobExecutor({
      github: createGitHubAppClient({ appId, privateKey }),
      chat: new Chat(geminiApiKey),
    })
  );
  return Response.json({ success: true, processed });
}
