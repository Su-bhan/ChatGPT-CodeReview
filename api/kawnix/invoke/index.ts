import { executeProviderOperation, handleKawnixRequest } from '../../../src/kawnix.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const secret = process.env.KAWNIX_PROVIDER_SECRET ?? '';

  if (!secret) {
    return Response.json(
      {
        success: false,
        error: {
          code: 'missing_secret',
          message: 'Kawnix provider secret is not configured.',
        },
      },
      { status: 500 }
    );
  }

  return handleKawnixRequest(request, {
    secret,
    agent: executeProviderOperation,
  });
}
