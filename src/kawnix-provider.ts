import {
  KAWNIX_MAX_REQUEST_BYTES,
  type KawnixProviderInput,
  validateKawnixInput,
} from './provider-contract.js';
import { KawnixJobError } from './kawnix-jobs.js';

export type KawnixProviderHandlers = {
  start?: (
    input: Extract<KawnixProviderInput, { operation: 'start' }>,
    request: Request
  ) => Promise<Record<string, unknown>>;
  status?: (
    input: Extract<KawnixProviderInput, { operation: 'status' }>,
    request: Request
  ) => Promise<Record<string, unknown>>;
  health?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
};

const response = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

const errorResponse = (
  status: number,
  code: string,
  message: string
) =>
  response(status, {
    success: false,
    error: { code, message },
  });

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
};

const isJsonRequest = (request: Request) => {
  const contentType = request.headers.get('Content-Type') ?? '';
  return contentType.toLowerCase().startsWith('application/json');
};

export const handleKawnixProviderRequest = async (
  request: Request,
  options: {
    bearerToken: string;
    handlers: KawnixProviderHandlers;
    maxRequestBytes?: number;
  }
) => {
  if (!options.bearerToken) {
    return errorResponse(
      500,
      'missing_provider_credential',
      'The provider credential is not configured.'
    );
  }

  if (request.method.toUpperCase() !== 'POST') {
    return errorResponse(
      405,
      'method_not_allowed',
      'Only POST requests are supported.'
    );
  }

  if (!isJsonRequest(request)) {
    return errorResponse(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json.'
    );
  }

  if (getBearerToken(request) !== options.bearerToken) {
    return errorResponse(
      401,
      'invalid_authentication',
      'A valid bearer credential is required.'
    );
  }

  const body = Buffer.from(await request.arrayBuffer());
  const maxRequestBytes =
    options.maxRequestBytes ?? KAWNIX_MAX_REQUEST_BYTES;
  if (body.length > maxRequestBytes) {
    return errorResponse(
      413,
      'request_too_large',
      `Request body must not exceed ${maxRequestBytes} bytes.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }

  const validation = validateKawnixInput(parsed);
  if (!validation.ok) {
    return errorResponse(
      400,
      validation.error.code,
      validation.error.message
    );
  }

  if (validation.input.operation === 'health') {
    const health = await (options.handlers.health?.() ?? {
      status: 'ready',
      service: 'chatgpt-codereview',
      capabilities: {
        review_pull_request: true,
        publish_review: true,
        streaming: false,
      },
    });
    return response(200, { success: true, data: health });
  }

  if (validation.input.operation === 'start') {
    if (!options.handlers.start) {
      return errorResponse(
        501,
        'operation_not_available',
        'Review job creation is not available.'
      );
    }
    try {
      const result = await options.handlers.start(validation.input, request);
      return response(202, { success: true, data: result });
    } catch (error) {
      if (error instanceof KawnixJobError) {
        return errorResponse(error.status, error.code, error.message);
      }
      return errorResponse(
        500,
        'internal_error',
        'The provider could not create the review job.'
      );
    }
  }

  if (!options.handlers.status) {
    return errorResponse(
      501,
      'operation_not_available',
      'Review job status is not available.'
    );
  }
  try {
    const result = await options.handlers.status(validation.input, request);
    return response(200, { success: true, data: result });
  } catch (error) {
    if (error instanceof KawnixJobError) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(
      500,
      'internal_error',
      'The provider could not retrieve the review job.'
    );
  }
};
