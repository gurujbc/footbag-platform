/**
 * Environment configuration for the Footbag platform.
 *
 * Validates required environment variables at module-load time so that
 * misconfiguration surfaces immediately at startup rather than at
 * first request. Expects dotenv to have been loaded before this module
 * is imported (i.e. `import 'dotenv/config'` must appear first in server.ts).
 */

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  dbPath: string;
  publicBaseUrl: string;
  sessionSecret: string;
  stubUsername: string;
  stubPassword: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadConfig(): AppConfig {
  const rawPort = requireEnv('PORT');
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid integer between 1 and 65535, got: ${rawPort}`);
  }

  return {
    port,
    nodeEnv: requireEnv('NODE_ENV'),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    dbPath: requireEnv('FOOTBAG_DB_PATH'),
    publicBaseUrl: requireEnv('PUBLIC_BASE_URL'),
    sessionSecret: requireEnv('SESSION_SECRET'),
    stubUsername: process.env.STUB_USERNAME ?? 'footbag',
    stubPassword: process.env.STUB_PASSWORD ?? 'Footbag!',
  };
}

export const config: AppConfig = loadConfig();
