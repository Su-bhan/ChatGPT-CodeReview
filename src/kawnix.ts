import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const KAWNIX_PROVIDER_ROUTE = '/api/kawnix/invoke';
export const KAWNIX_REPLAY_TTL_MS = 600_000;
export const KAWNIX_MAX_BODY_BYTES = 64 * 1024;

export const KAWNIX_PROVIDER_MANIFEST = {
  metadata: {
    name: 'ChatGPT Code Review',
    version: '2.0.0',
    description: 'Review GitHub pull requests submitted through Kawnix.',
    owner: 'publisher',
  },
  endpoint: {
    method: 'POST',
    path: KAWNIX_PROVIDER_ROUTE,
    contentType: 'application/json',
    baseUrl: 'https://<your-public-domain>',
    timeoutMs: 30000,
    auth: {
      type: 'bearer',
      note: 'The bearer token is stored and supplied by Kawnix.',
    },
  },
  input: {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['health', 'start', 'status'] },
      repository: {
        type: 'object',
        properties: {
          owner: { type: 'string', maxLength: 100 },
          name: { type: 'string', maxLength: 100 },
        },
        required: ['owner', 'name'],
        additionalProperties: false,
      },
      pull_request_number: { type: 'integer', minimum: 1 },
      commit_sha: { type: 'string', maxLength: 128 },
      publishing_mode: {
        type: 'string',
        enum: ['report_only', 'pull_request_review'],
        default: 'report_only',
      },
      prompt: { type: 'string', maxLength: 2000 },
      include_patterns: { type: 'array', maxItems: 100 },
      ignore_patterns: { type: 'array', maxItems: 100 },
      idempotency_key: { type: 'string', maxLength: 256 },
      job_id: { type: 'string', maxLength: 256 },
    },
    additionalProperties: false,
  },
  limits: {
    maxFiles: 100,
    maxPatchBytesPerFile: 200000,
    maxTotalPatchBytes: 1000000,
    maxFindings: 100,
    maxResultBytes: 256000,
  },
  capabilities: {
    sync: false,
    streaming: false,
    multipart: false,
    customResponseMappings: false,
  },
  auth: {
    type: 'bearer',
  },
  pricing: {
    model: 'per_call',
    requiresTokenCount: false,
    note: 'No token-metered billing is enabled for this provider endpoint.',
  },
  successCriteria: {
    statusCodes: [200, 202],
    responseBody: {
      type: 'object',
      required: ['success'],
      properties: {
        success: { type: 'boolean', const: true },
        job_id: { type: 'string' },
        status: { type: 'string' },
        result: { type: 'object' },
      },
      additionalProperties: true,
    },
  },
} as const;

const REQUIRED_HEADERS = [
  'X-Kawnix-Signature-Version',
  'X-Kawnix-Key-ID',
  'X-Kawnix-Timestamp',
  'X-Kawnix-Nonce',
  'X-Kawnix-Request-ID',
  'X-Kawnix-Endpoint-ID',
  'X-Kawnix-Manifest-ID',
  'X-Kawnix-Subscription-ID',
  'X-Kawnix-Body-SHA256',
  'X-Kawnix-Signature',
] as const;

const replayStore = new Map<string, number>();

export type KawnixProviderOperation =
  | 'health'
  | 'review';

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

export const normalizeGatewayPathAndQuery = (url: URL) => {
  const pathname = url.pathname || '/';
  const queryEntries = Array.from(new URLSearchParams(url.search).entries()).map(
    ([name, value]) => [encodeURIComponent(name), encodeURIComponent(value)] as const
  );

  queryEntries.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyDiff = leftKey.localeCompare(rightKey);
    return keyDiff !== 0 ? keyDiff : leftValue.localeCompare(rightValue);
  });

  const query = queryEntries
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  return `${pathname}${query ? `?${query}` : ''}`;
};

export const buildKawnixSignaturePayload = ({
  version,
  timestamp,
  nonce,
  method,
  url,
  bodyHash,
  requestId,
  endpointId,
  manifestId,
  subscriptionId,
}: {
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
}) =>
  [
    'KAWNIX-HMAC-V1',
    version,
    String(timestamp),
    nonce,
    method.toUpperCase(),
    normalizeGatewayPathAndQuery(url),
    bodyHash,
    requestId,
    endpointId,
    manifestId,
    subscriptionId,
  ].join('\n');

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const rejectInvalidSignature = (status: number, code: string) =>
  jsonResponse(status, {
    success: false,
    error: {
      code,
      message: 'Invalid or expired Kawnix signature.',
    },
  });

const buildKawnixBodyHash = (body: Uint8Array) =>
  createHash('sha256').update(body).digest('hex');

const safeEqualHex = (expected: string, actual: string) => {
  const expectedBuffer = Buffer.from(expected.toLowerCase(), 'hex');
  const actualBuffer = Buffer.from(actual.toLowerCase(), 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
};

export const verifyKawnixSignature = ({
  method,
  url,
  headers,
  body,
  secret,
  now = Date.now(),
  replayStoreRef = replayStore,
}: {
  method: string;
  url: URL;
  headers: Headers;
  body: Buffer;
  secret: string;
  now?: number;
  replayStoreRef?: Map<string, number>;
}): KawnixVerificationResult => {
  for (const header of REQUIRED_HEADERS) {
    if (!headers.has(header)) {
      return { ok: false, status: 401, code: 'missing_header' };
    }
  }

  const version = headers.get('X-Kawnix-Signature-Version')?.trim();
  if (version !== 'v1') {
    return { ok: false, status: 401, code: 'unsupported_version' };
  }

  const timestampHeader = headers.get('X-Kawnix-Timestamp');
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300_000) {
    return { ok: false, status: 401, code: 'stale_timestamp' };
  }

  const bodyHashHeader = headers.get('X-Kawnix-Body-SHA256');
  const bodyHash = buildKawnixBodyHash(body);
  if (!bodyHashHeader || bodyHashHeader.toLowerCase() !== bodyHash) {
    return { ok: false, status: 401, code: 'invalid_body_hash' };
  }

  const keyId = headers.get('X-Kawnix-Key-ID') ?? '';
  const nonce = headers.get('X-Kawnix-Nonce') ?? '';
  const requestId = headers.get('X-Kawnix-Request-ID') ?? '';
  const endpointId = headers.get('X-Kawnix-Endpoint-ID') ?? '';
  const manifestId = headers.get('X-Kawnix-Manifest-ID') ?? '';
  const subscriptionId = headers.get('X-Kawnix-Subscription-ID') ?? '';

  const expectedSignature = createHmac('sha256', secret)
    .update(
      buildKawnixSignaturePayload({
        version,
        timestamp,
        nonce,
        method,
        url,
        bodyHash,
        requestId,
        endpointId,
        manifestId,
        subscriptionId,
      })
    )
    .digest('hex');

  const actualSignature = headers.get('X-Kawnix-Signature') ?? '';
  if (!safeEqualHex(expectedSignature, actualSignature)) {
    return { ok: false, status: 401, code: 'invalid_signature' };
  }

  const replayKey = `${keyId}:${nonce}`;
  const previousTimestamp = replayStoreRef.get(replayKey);
  if (previousTimestamp && now - previousTimestamp < KAWNIX_REPLAY_TTL_MS) {
    return { ok: false, status: 401, code: 'replayed_nonce' };
  }

  replayStoreRef.set(replayKey, now);

  for (const [existingKey, existingTimestamp] of replayStoreRef.entries()) {
    if (existingTimestamp + KAWNIX_REPLAY_TTL_MS <= now && existingKey !== replayKey) {
      replayStoreRef.delete(existingKey);
    }
  }

  const rawInput = body.toString('utf8');
  if (!rawInput.trim()) {
    return { ok: false, status: 400, code: 'empty_body' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return { ok: false, status: 400, code: 'invalid_json' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, status: 400, code: 'invalid_input' };
  }

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.operation !== 'string') {
    return { ok: false, status: 400, code: 'invalid_operation' };
  }

  const operation = candidate.operation as KawnixProviderOperation;
  if (operation !== 'health' && operation !== 'review') {
    return { ok: false, status: 400, code: 'unsupported_operation' };
  }

  return {
    ok: true,
    method,
    url,
    body,
    input: {
      operation,
      prompt: typeof candidate.prompt === 'string' ? candidate.prompt : undefined,
      diff: typeof candidate.diff === 'string' ? candidate.diff : undefined,
      file: typeof candidate.file === 'string' ? candidate.file : undefined,
      repo: typeof candidate.repo === 'string' ? candidate.repo : undefined,
    },
    keyId,
    nonce,
    requestId,
    endpointId,
    manifestId,
    subscriptionId,
  };
};

export const executeProviderOperation = (
  input: KawnixProviderInput
): Record<string, unknown> => {
  if (input.operation === 'health') {
    return {
      answer: 'KAWNIX_PING',
    };
  }

  const prompt = input.prompt ?? 'Review request received';
  const diffLength = input.diff?.length ?? 0;
  const fileLabel = input.file ? ` for ${input.file}` : '';
  const repoLabel = input.repo ? ` in ${input.repo}` : '';

  return {
    answer: `review received${fileLabel}${repoLabel}`,
    summary: `${prompt.slice(0, 160)}${prompt.length > 160 ? '…' : ''}`,
    diffLength,
    status: 'ok',
  };
};

export const handleKawnixRequest = async (
  request: Request,
  options: {
    secret: string;
    agent?: (input: KawnixProviderInput) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }
) => {
  const secret = options.secret ?? '';
  if (!secret) {
    return rejectInvalidSignature(500, 'missing_secret');
  }

  if (request.method.toUpperCase() !== 'POST') {
    return rejectInvalidSignature(405, 'method_not_allowed');
  }

  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > KAWNIX_MAX_BODY_BYTES) {
    return rejectInvalidSignature(413, 'body_too_large');
  }

  const verification = verifyKawnixSignature({
    method: request.method,
    url: new URL(request.url),
    headers: request.headers,
    body,
    secret,
  });

  if (!verification.ok) {
    return rejectInvalidSignature(verification.status, verification.code);
  }

  const result = await (options.agent ?? executeProviderOperation)(verification.input);

  return jsonResponse(200, {
    success: true,
    response: result,
  });
};
