import { createHash, createHmac } from 'node:crypto';

import {
  KAWNIX_PROVIDER_ROUTE,
  buildKawnixSignaturePayload,
  handleKawnixRequest,
} from './kawnix.js';

const secret = 'kawnix-provider-secret';
const endpointUrl = `https://provider.example.com${KAWNIX_PROVIDER_ROUTE}`;

const makeSignedHeaders = ({
  body,
  timestamp = Date.now(),
  nonce = `nonce-${Math.random().toString(16).slice(2)}`,
  requestId = `req-${Math.random().toString(16).slice(2)}`,
  endpointId = 'ep-123',
  manifestId = 'manifest-456',
  subscriptionId = 'sub-789',
}: {
  body: string | Uint8Array;
  timestamp?: number;
  nonce?: string;
  requestId?: string;
  endpointId?: string;
  manifestId?: string;
  subscriptionId?: string;
}) => {
  const buffer = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
  const bodyHash = createHash('sha256').update(buffer).digest('hex');
  const url = new URL(endpointUrl);
  const version = 'v1';
  const signingPayload = buildKawnixSignaturePayload({
    version,
    timestamp,
    nonce,
    method: 'POST',
    url,
    bodyHash,
    requestId,
    endpointId,
    manifestId,
    subscriptionId,
  });
  const signature = createHmac('sha256', secret).update(signingPayload).digest('hex');

  const headers = new Headers();
  headers.set('X-Kawnix-Signature-Version', version);
  headers.set('X-Kawnix-Key-ID', 'test-key-id');
  headers.set('X-Kawnix-Timestamp', String(timestamp));
  headers.set('X-Kawnix-Nonce', nonce);
  headers.set('X-Kawnix-Request-ID', requestId);
  headers.set('X-Kawnix-Endpoint-ID', endpointId);
  headers.set('X-Kawnix-Manifest-ID', manifestId);
  headers.set('X-Kawnix-Subscription-ID', subscriptionId);
  headers.set('X-Kawnix-Body-SHA256', bodyHash);
  headers.set('X-Kawnix-Signature', signature);
  return headers;
};

describe('Kawnix provider verification', () => {
  test('accepts a valid signed health request and executes the agent once', async () => {
    const body = JSON.stringify({ operation: 'health' });
    const headers = makeSignedHeaders({ body });
    const agent = jest.fn(() => ({ answer: 'KAWNIX_PING' }));

    const response = await handleKawnixRequest(
      new Request(endpointUrl, { method: 'POST', headers, body }),
      { secret, agent }
    );

    expect(response.status).toBe(200);
    expect(agent).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      success: true,
      response: { answer: 'KAWNIX_PING' },
    });
  });

  test('rejects missing signed headers and does not execute the agent', async () => {
    const agent = jest.fn();
    const response = await handleKawnixRequest(
      new Request(endpointUrl, {
        method: 'POST',
        body: JSON.stringify({ operation: 'health' }),
      }),
      { secret, agent }
    );

    expect(response.status).toBe(401);
    expect(agent).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'missing_header' },
    });
  });

  test('rejects tampered bodies and signatures', async () => {
    const body = JSON.stringify({ operation: 'health' });
    const headers = makeSignedHeaders({ body });
    const agent = jest.fn();

    const response = await handleKawnixRequest(
      new Request(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operation: 'review', prompt: 'tampered' }),
      }),
      { secret, agent }
    );

    expect(response.status).toBe(401);
    expect(agent).not.toHaveBeenCalled();
  });

  test('rejects expired timestamps', async () => {
    const body = JSON.stringify({ operation: 'health' });
    const expiredTimestamp = Date.now() - 301_000;
    const headers = makeSignedHeaders({ body, timestamp: expiredTimestamp });
    const agent = jest.fn();

    const response = await handleKawnixRequest(
      new Request(endpointUrl, { method: 'POST', headers, body }),
      { secret, agent }
    );

    expect(response.status).toBe(401);
    expect(agent).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'stale_timestamp' },
    });
  });

  test('rejects replayed nonces', async () => {
    const body = JSON.stringify({ operation: 'health' });
    const nonce = 'repeatable-nonce';
    const headers = makeSignedHeaders({ body, nonce });
    const agent = jest.fn();

    const first = await handleKawnixRequest(
      new Request(endpointUrl, { method: 'POST', headers, body }),
      { secret, agent }
    );
    const second = await handleKawnixRequest(
      new Request(endpointUrl, {
        method: 'POST',
        headers: makeSignedHeaders({ body, nonce }),
        body,
      }),
      { secret, agent }
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(agent).toHaveBeenCalledTimes(1);
    expect(await second.json()).toMatchObject({
      success: false,
      error: { code: 'replayed_nonce' },
    });
  });

  test('rejects invalid input and unsupported operations', async () => {
    const body = JSON.stringify({ operation: 'unsupported' });
    const headers = makeSignedHeaders({ body });
    const agent = jest.fn();

    const response = await handleKawnixRequest(
      new Request(endpointUrl, { method: 'POST', headers, body }),
      { secret, agent }
    );

    expect(response.status).toBe(400);
    expect(agent).not.toHaveBeenCalled();
  });
});
