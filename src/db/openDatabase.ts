import BetterSqlite3 = require('better-sqlite3');

/**
 * Minimal SQLite connection bootstrap for the Footbag platform.
 *
 * This helper exists so db.ts can remain the single prepared-statement surface
 * while keeping the raw connection-open / PRAGMA bootstrap concerns separate.
 *
 * Scope for this MVFP helper:
 * - open one better-sqlite3 connection
 * - apply the documented startup PRAGMAs for the app connection
 *
 * Out of scope:
 * - statement preparation
 * - transaction helper logic
 * - checkpoint / backup behavior
 * - health/readiness composition
 * - any schema migration or initialization script behavior
 */
export const DEFAULT_DB_FILENAME = './database/footbag.db';

export type SqliteDatabase = BetterSqlite3.Database;

function applyStartupPragmas(db: SqliteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
}

export function openDatabase(filename = DEFAULT_DB_FILENAME): SqliteDatabase {
  const db = new BetterSqlite3(filename);
  applyStartupPragmas(db);
  return db;
}
