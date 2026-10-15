const { Headers, Request, Response } = require('node-fetch');
const fetch = require('node-fetch').default;

if (!globalThis.fetch) {
  // @ts-ignore node-fetch and the DOM fetch types are structurally incompatible.
  globalThis.fetch = fetch;
  // @ts-ignore node-fetch and the DOM fetch types are structurally incompatible.
  globalThis.Headers = Headers;
  // @ts-ignore node-fetch and the DOM fetch types are structurally incompatible.
  globalThis.Request = Request;
  // @ts-ignore node-fetch and the DOM fetch types are structurally incompatible.
  globalThis.Response = Response;
}
