export function cleanupExpiredAuthRows(
  sqlite: {
    transaction: (callback: () => void) => () => void;
    prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
  },
  now: number,
) {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `DELETE FROM oauth_states
         WHERE rowid IN (
           SELECT rowid FROM oauth_states
           WHERE expires_at <= ? OR consumed_at IS NOT NULL
           ORDER BY expires_at ASC
           LIMIT 100
         )`,
      )
      .run(now);
    sqlite
      .prepare(
        `DELETE FROM sessions
         WHERE rowid IN (
           SELECT rowid FROM sessions
           WHERE expires_at <= ? OR revoked_at IS NOT NULL
           ORDER BY expires_at ASC
           LIMIT 100
         )`,
      )
      .run(now);
  })();
}
