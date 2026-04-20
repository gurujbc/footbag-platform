/**
 * Structured JSON logger for the Footbag platform.
 *
 * Intentionally simple: a thin wrapper around console.log/error that
 * outputs newline-delimited JSON. No external logging dependencies.
 * Log level is compared by severity so that e.g. LOG_LEVEL=warn suppresses
 * info and debug output. Log level is read from the config singleton.
 */
import { config } from './env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function normalizeLevel(level: string): LogLevel {
  const lower = level.toLowerCase();
  if (lower in LEVEL_RANK) return lower as LogLevel;
  return 'info';
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(level: string): Logger {
  const minRank = LEVEL_RANK[normalizeLevel(level)];

  function write(lvl: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_RANK[lvl] < minRank) return;
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...meta,
    };
    const output = JSON.stringify(line);
    if (lvl === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info:  (msg, meta) => write('info',  msg, meta),
    warn:  (msg, meta) => write('warn',  msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}

export const logger: Logger = createLogger(config.logLevel);
