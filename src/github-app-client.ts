import { createSign } from 'node:crypto';

import type { KawnixGitHubClient } from './kawnix-review.js';

type GitHubFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<Response>;

type GitHubInstallation = {
  id: number;
};

const base64Url = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const createAppJwt = (
  appId: string,
  privateKey: string,
  now = Math.floor(Date.now() / 1000)
) => {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 540,
      iss: appId,
    })
  );
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  return `${unsignedToken}.${base64Url(signer.sign(privateKey))}`;
};

const parseError = async (response: Response) => {
  const body = await response.text();
  return body.slice(0, 500) || `GitHub request failed (${response.status}).`;
};

export class GitHubAppClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GitHubAppClientError';
    this.status = status;
    this.code = code;
  }
}

export type GitHubAppClientOptions = {
  appId: string;
  privateKey: string;
  apiBaseUrl?: string;
  fetchImpl?: GitHubFetch;
  installationToken?: string;
};

export const createGitHubAppClient = (
  options: GitHubAppClientOptions
): KawnixGitHubClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
  let cachedToken: { value: string; expiresAt: number } | undefined;

  const appRequest = async (
    path: string,
    method = 'GET',
    body?: Record<string, unknown>
  ) => {
    const jwt = createAppJwt(options.appId, options.privateKey);
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new GitHubAppClientError(
        response.status,
        response.status === 404 ? 'repository_not_found' : 'github_unavailable',
        await parseError(response)
      );
    }
    return response;
  };

  const getInstallationToken = async (owner: string, repository: string) => {
    if (options.installationToken) {
      return options.installationToken;
    }

    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.value;
    }

    const installationResponse = await appRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/installation`
    );
    const installation = (await installationResponse.json()) as GitHubInstallation;
    if (!Number.isInteger(installation.id)) {
      throw new GitHubAppClientError(
        502,
        'github_unavailable',
        'GitHub did not return a valid App installation.'
      );
    }

    const tokenResponse = await appRequest(
      `/app/installations/${installation.id}/access_tokens`,
      'POST'
    );
    const tokenBody = (await tokenResponse.json()) as {
      token?: string;
      expires_at?: string;
    };
    if (!tokenBody.token) {
      throw new GitHubAppClientError(
        502,
        'github_unavailable',
        'GitHub did not return an installation token.'
      );
    }

    cachedToken = {
      value: tokenBody.token,
      expiresAt: tokenBody.expires_at
        ? Date.parse(tokenBody.expires_at)
        : Date.now() + 3_000_000,
    };
    return tokenBody.token;
  };

  const repositoryRequest = async (
    owner: string,
    repository: string,
    path: string,
    method = 'GET',
    body?: Record<string, unknown>
  ) => {
    const token = await getInstallationToken(owner, repository);
    const response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new GitHubAppClientError(
        response.status,
        response.status === 404
          ? 'pull_request_not_found'
          : 'github_unavailable',
        await parseError(response)
      );
    }
    return response;
  };

  return {
    listPullRequestFiles: async (owner, repository, pullRequestNumber) => {
      const response = await repositoryRequest(
        owner,
        repository,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullRequestNumber}/files?per_page=100`
      );
      const files = (await response.json()) as Array<{
        filename: string;
        status: string;
        patch?: string;
      }>;
      return files;
    },
    createPullRequestReview: async ({
      owner,
      repository,
      pullRequestNumber,
      commitSha,
      body,
      comments,
    }) => {
      const response = await repositoryRequest(
        owner,
        repository,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullRequestNumber}/reviews`,
        'POST',
        {
          body,
          event: 'COMMENT',
          ...(commitSha ? { commit_id: commitSha } : {}),
          comments,
        }
      );
      const result = (await response.json()) as { html_url?: string };
      return { htmlUrl: result.html_url };
    },
    listPullRequestReviews: async (owner, repository, pullRequestNumber) => {
      const response = await repositoryRequest(
        owner,
        repository,
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${pullRequestNumber}/reviews?per_page=100`
      );
      const reviews = (await response.json()) as Array<{
        body?: string;
        html_url?: string;
      }>;
      return reviews.map((review) => ({
        body: review.body,
        htmlUrl: review.html_url,
      }));
    },
  };
};
