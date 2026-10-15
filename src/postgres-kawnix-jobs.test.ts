import { PostgresKawnixJobStore } from './postgres-kawnix-jobs';

describe('PostgresKawnixJobStore', () => {
  test('is constructed from a database URL', () => {
    const store = new PostgresKawnixJobStore(
      'postgres://user:password@localhost:5432/reviews'
    );

    expect(store).toBeInstanceOf(PostgresKawnixJobStore);
  });
});
