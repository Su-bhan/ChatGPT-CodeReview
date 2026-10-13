import { Chat } from '../src/chat';

type FetchMock = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status?: number;
  json?(): Promise<unknown>;
  text?(): Promise<string>;
}>;

const fetchMock = jest.fn<ReturnType<FetchMock>, Parameters<FetchMock>>();
const runtimeGlobal = globalThis as typeof globalThis & { fetch: FetchMock };
const originalFetch = runtimeGlobal.fetch;

describe('Chat', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    runtimeGlobal.fetch = fetchMock;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '{"lgtm": true, "review_comment": ""}' }],
            },
          },
        ],
      }),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    runtimeGlobal.fetch = originalFetch;
  });

  test('uses Gemini API with the default model and API key', async () => {
    delete process.env.MODEL;

    const chat = new Chat('test-key');
    await chat.codeReview('@@ -1,3 +1,4 @@\n+new line\n old line');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': 'test-key',
        },
      })
    );
  });

  test('passes model and generation settings to Gemini', async () => {
    process.env.MODEL = 'gemini-2.5-pro';
    process.env.temperature = '0.5';
    process.env.top_p = '0.9';
    process.env.max_tokens = '2048';

    const chat = new Chat('test-key');
    await chat.codeReview('@@ -1,3 +1,4 @@\n+new line\n old line');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toContain('/gemini-2.5-pro:generateContent');
    expect(request.generationConfig).toEqual({
      responseMimeType: 'application/json',
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 2048,
    });
    expect(request.contents[0].role).toBe('user');
    expect(request.contents[0].parts[0].text).toContain('new line');
  });

  test('returns review arrays from Gemini JSON responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"reviews":[{"lgtm":false,"review_comment":"Found a bug"}]}',
                },
              ],
            },
          },
        ],
      }),
    });

    const chat = new Chat('test-key');
    const result = await chat.codeReview('@@ -1,3 +1,4 @@\n+new line\n old line');

    expect(result).toEqual([
      { lgtm: false, review_comment: 'Found a bug' },
    ]);
  });

  test('returns a text response as a review when it is not valid JSON', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: 'Please fix this issue.' }],
            },
          },
        ],
      }),
    });

    const chat = new Chat('test-key');
    const result = await chat.codeReview('@@ -1,3 +1,4 @@\n+new line\n old line');

    expect(result).toEqual({
      lgtm: false,
      hunk_header: '@@ -1,3 +1,4 @@',
      review_comment: 'Please fix this issue.',
    });
  });

  test('throws an explicit error when Gemini rejects the request', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid API key',
    });

    const chat = new Chat('test-key');

    await expect(
      chat.codeReview('@@ -1,3 +1,4 @@\n+new line\n old line')
    ).rejects.toThrow('Gemini API request failed (400): Invalid API key');
  });

  test('returns an empty review without calling Gemini for an empty patch', async () => {
    const chat = new Chat('test-key');
    const result = await chat.codeReview('');

    expect(result).toEqual({ lgtm: true, review_comment: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
