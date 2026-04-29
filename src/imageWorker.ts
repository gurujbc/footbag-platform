/**
 * Image worker entry point.
 *
 * Standalone Express server that wraps the Sharp pipeline behind an HTTP
 * boundary. Phase 2 will package this as the `image` Docker container; in
 * Phase 1 it runs locally via `npm run dev:image`. Reads its own env vars
 * directly because it is a separate process from the web app and must not
 * require web-only config (FOOTBAG_DB_PATH, SESSION_SECRET, etc.).
 */
import express, { Request, Response, NextFunction } from 'express';
import { detectImageType, processAvatar, type ProcessedImage } from './lib/imageProcessing';

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  const n = parseInt(raw, 10);
  if (n < min || n > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got: ${raw}`);
  }
  return n;
}

class Semaphore {
  private inFlight = 0;
  private waiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  constructor(private readonly max: number, private readonly waitTimeoutMs: number) {}

  async acquire(): Promise<void> {
    if (this.inFlight < this.max) {
      this.inFlight++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error('semaphore wait timeout'));
      }, this.waitTimeoutMs);
      this.waiters.push({ resolve, reject, timer });
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else if (this.inFlight > 0) {
      this.inFlight--;
    }
  }
}

export interface ImageWorkerOptions {
  maxConcurrent?: number;
  semaphoreWaitMs?: number;
  // Test seam: substitute the Sharp pipeline with a slow / failing impl
  // so semaphore-busy and error paths can be exercised without flake.
  processAvatarImpl?: (data: Buffer) => Promise<ProcessedImage>;
}

export function createImageWorkerApp(opts: ImageWorkerOptions = {}): express.Express {
  const maxConcurrent =
    opts.maxConcurrent ?? parseIntEnv('IMAGE_MAX_CONCURRENT', 2, 1, 16);
  const semaphoreWaitMs =
    opts.semaphoreWaitMs ?? parseIntEnv('IMAGE_SEMAPHORE_WAIT_MS', 30000, 1, 600000);
  const processImpl = opts.processAvatarImpl ?? processAvatar;
  const semaphore = new Semaphore(maxConcurrent, semaphoreWaitMs);

  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post(
    '/process/avatar',
    express.raw({ type: 'application/octet-stream', limit: AVATAR_MAX_BYTES }),
    async (req: Request, res: Response, next: NextFunction) => {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'empty body' });
        return;
      }
      if (!detectImageType(buf)) {
        res.status(400).json({ error: 'unrecognized image type' });
        return;
      }

      try {
        await semaphore.acquire();
      } catch {
        res.set('Retry-After', '1');
        res.status(503).json({ error: 'image worker busy' });
        return;
      }

      try {
        const processed = await processImpl(buf);
        res.status(200).json({
          thumb: processed.thumb.toString('base64'),
          display: processed.display.toString('base64'),
          widthPx: processed.widthPx,
          heightPx: processed.heightPx,
        });
      } catch (err: unknown) {
        next(err);
      } finally {
        semaphore.release();
      }
    },
  );

  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload too large' });
      return;
    }
    res.status(500).json({ error: err.message || 'image processing failed' });
  });

  return app;
}

/* c8 ignore start -- standalone entry block, exercised by `npm run dev:image` */
if (require.main === module) {
  const port = parseIntEnv('IMAGE_PORT', 4000, 1, 65535);
  const app = createImageWorkerApp();
  app.listen(port, () => {
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'image worker listening', port }) + '\n',
    );
  });
}
/* c8 ignore stop */
