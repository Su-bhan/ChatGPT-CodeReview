import type { KawnixRepository } from './provider-contract.js';

export type KawnixRepositoryAuthorizer = (
  ownerId: string,
  repository: KawnixRepository
) => boolean | Promise<boolean>;

export const parseKawnixRepositoryAccess = (
  value: string | undefined
): Map<string, Set<string>> => {
  if (!value?.trim()) {
    return new Map();
  }

  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('KAWNIX_REPOSITORY_ACCESS must be a JSON object.');
  }

  const access = new Map<string, Set<string>>();
  for (const [ownerId, repositories] of Object.entries(parsed)) {
    if (
      !Array.isArray(repositories) ||
      repositories.some(
        (repository) =>
          typeof repository !== 'string' ||
          !/^[^/]+\/[^/]+$/.test(repository)
      )
    ) {
      throw new Error(
        'KAWNIX_REPOSITORY_ACCESS values must be arrays of owner/name strings.'
      );
    }
    access.set(ownerId, new Set(repositories.map((repository) => repository.toLowerCase())));
  }
  return access;
};

export const createKawnixRepositoryAuthorizer = (
  access: Map<string, Set<string>>
): KawnixRepositoryAuthorizer => (ownerId, repository) => {
  const allowedRepositories = access.get(ownerId);
  return Boolean(
    allowedRepositories?.has(
      `${repository.owner}/${repository.name}`.toLowerCase()
    )
  );
};
