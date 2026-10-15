import {
  createKawnixRepositoryAuthorizer,
  parseKawnixRepositoryAccess,
} from './kawnix-authorization';

describe('Kawnix repository authorization', () => {
  test('parses owner-scoped repository access', () => {
    const access = parseKawnixRepositoryAccess(
      '{"owner-hash":["Acme/Repo"]}'
    );
    const authorize = createKawnixRepositoryAuthorizer(access);

    expect(authorize('owner-hash', { owner: 'acme', name: 'repo' })).toBe(true);
    expect(authorize('other-owner', { owner: 'acme', name: 'repo' })).toBe(false);
  });

  test('rejects malformed access configuration', () => {
    expect(() => parseKawnixRepositoryAccess('[]')).toThrow(
      'KAWNIX_REPOSITORY_ACCESS must be a JSON object.'
    );
    expect(() => parseKawnixRepositoryAccess('{"owner":["invalid"]}')).toThrow(
      'KAWNIX_REPOSITORY_ACCESS values must be arrays of owner/name strings.'
    );
  });
});
