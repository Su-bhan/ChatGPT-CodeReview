import { InMemoryKawnixJobStore } from '../../../src/kawnix-jobs.js';
import { PostgresKawnixJobStore } from '../../../src/postgres-kawnix-jobs.js';
import { jsonResponse } from '../../../src/json-response.js';

export const config = {
  runtime: 'nodejs',
};

const jobStore = process.env.DATABASE_URL
  ? new PostgresKawnixJobStore(process.env.DATABASE_URL)
  : new InMemoryKawnixJobStore();

export default async function handler(request: Request) {
  const maintenanceToken = process.env.KAWNIX_WORKER_TOKEN ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  const suppliedToken = authorization.replace(/^Bearer\s+/i, '').trim();

  if (request.method !== 'POST') {
    return jsonResponse(
      { success: false, error: { code: 'method_not_allowed' } },
      405
    );
  }
  if (!maintenanceToken) {
    return jsonResponse(
      { success: false, error: { code: 'missing_maintenance_token' } },
      500
    );
  }
  if (suppliedToken !== maintenanceToken) {
    return jsonResponse(
      { success: false, error: { code: 'invalid_maintenance_authentication' } },
      401
    );
  }

  const cleanup = await jobStore.cleanup();
  return jsonResponse({ success: true, cleanup });
}
