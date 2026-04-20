// dotenv MUST be imported first, before any module that reads process.env
import 'dotenv/config';

import { config } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server started', {
    port: config.port,
    env: config.nodeEnv,
    db: config.dbPath,
  });
});

function shutdown(signal: string): void {
  logger.info('graceful shutdown initiated', { signal });
  server.close(() => {
    logger.info('server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
