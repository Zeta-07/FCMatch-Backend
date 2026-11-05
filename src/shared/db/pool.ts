import pg from 'pg';

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    options: '-c timezone=UTC',
  });
}
