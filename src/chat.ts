type Review = {
  lgtm: boolean;
  review_comment: string;
  hunk_header?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

declare const fetch: (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<GeminiResponse>;
  text(): Promise<string>;
}>;

export class Chat {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get model(): string {
    return process.env.MODEL || 'gemini-2.5-flash';
  }

  private generatePrompt = (patch: string) => {
    const answerLanguage = process.env.LANGUAGE
      ? `Answer me in ${process.env.LANGUAGE},`
      : '';

    const userPrompt =
      process.env.PROMPT ||
      'Please review the following code patch. Focus on potential bugs, risks, and improvement suggestions.';

    const jsonFormatRequirement =
      '\nProvide your feedback in a strict JSON format with the following structure:\n' +
      '{\n' +
      '  "reviews": [\n' +
      '    {\n' +
      '      "hunk_header": string, // The @@ hunk header (e.g., "@@ -10,5 +10,7 @@"), optional\n' +
      '      "lgtm": boolean, // true if this hunk looks good, false if there are concerns\n' +
      '      "review_comment": string // Your detailed review comments for this hunk. Can use markdown syntax. Empty string if lgtm is true.\n' +
      '    }\n' +
      '  ]\n' +
      '}\n' +
      'Review each hunk (marked by @@) separately and provide feedback for hunks that need improvement.\n' +
      'Ensure your response is a valid JSON object with a reviews array.\n';

    return `${userPrompt}${jsonFormatRequirement} ${answerLanguage}:\n    ${patch}\n    `;
  };

  public codeReview = async (
    patch: string
  ): Promise<Review[] | Review> => {
    if (!patch) {
      return {
        lgtm: true,
        review_comment: '',
      };
    }

    console.time('code-review cost');
    const generationConfig: {
      responseMimeType: string;
      temperature: number;
      topP: number;
      maxOutputTokens?: number;
    } = {
      responseMimeType: 'application/json',
      temperature: Number(process.env.temperature) || 1,
      topP: Number(process.env.top_p) || 1,
    };

    if (process.env.max_tokens) {
      generationConfig.maxOutputTokens = Number(process.env.max_tokens);
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model
      )}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: this.generatePrompt(patch) }],
            },
          ],
          generationConfig,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini API request failed (${response.status}): ${errorBody}`
      );
    }

    const result = await response.json();
    console.timeEnd('code-review cost');

    const responseText =
      result.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('') || '';

    if (!responseText) {
      return {
        lgtm: true,
        review_comment: '',
      };
    }

    try {
      const json = JSON.parse(responseText);
      if (json.reviews && Array.isArray(json.reviews)) {
        return json.reviews;
      }
      return json;
    } catch {
      return {
        lgtm: false,
        hunk_header: patch.split('\n')[0].startsWith('@@')
          ? patch.split('\n')[0]
          : undefined,
        review_comment: responseText,
      };
    }
  };
}
