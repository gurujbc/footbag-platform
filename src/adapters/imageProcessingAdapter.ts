/**
 * ImageProcessingAdapter: HTTP boundary to the `image` worker container.
 *
 * Single production code path -- there is no in-process variant. Tests inject
 * `fetchImpl` (the same shape as `LiveSesAdapter`'s `sesClient` injection) and
 * the fake fetch invokes the real Sharp pipeline inline so test fixtures still
 * produce real processed bytes. Same adapter code path runs in tests, local
 * dev (`npm run dev:image` on localhost:4001), compose dev (image:4000),
 * staging, and prod.
 */
import { config } from '../config/env';
import type { ProcessedImage } from '../lib/imageProcessing';

export interface ImageProcessingAdapter {
  processAvatar(data: Buffer): Promise<ProcessedImage>;
}

export class ImageProcessingError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

interface ProcessAvatarResponse {
  thumb: string;
  display: string;
  widthPx: number;
  heightPx: number;
}

export function createHttpImageAdapter(opts: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ImageProcessingAdapter {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30000;
  return {
    async processAvatar(data: Buffer): Promise<ProcessedImage> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        // Node's fetch accepts Buffer at runtime, but TS lib.dom's BodyInit
        // omits it. Cast through unknown to keep the call site readable without
        // copying bytes.
        res = await fetchImpl(`${baseUrl}/process/avatar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: data as unknown as BodyInit,
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') {
          throw new ImageProcessingError(`image worker timed out after ${timeoutMs}ms`);
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new ImageProcessingError(`image worker request failed: ${msg}`);
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 400) {
          throw new ImageProcessingError(`image worker rejected image type: ${body}`, 400);
        }
        throw new ImageProcessingError(
          `image worker returned ${res.status}: ${body}`,
          res.status,
        );
      }

      const json = (await res.json()) as ProcessAvatarResponse;
      return {
        thumb: Buffer.from(json.thumb, 'base64'),
        display: Buffer.from(json.display, 'base64'),
        widthPx: json.widthPx,
        heightPx: json.heightPx,
      };
    },
  };
}

let singleton: ImageProcessingAdapter | null = null;

export function getImageProcessingAdapter(): ImageProcessingAdapter {
  if (!singleton) {
    singleton = createHttpImageAdapter({
      baseUrl: config.imageProcessorUrl,
      timeoutMs: config.imageProcessTimeoutMs,
    });
  }
  return singleton;
}

export function setImageProcessingAdapterForTests(adapter: ImageProcessingAdapter): void {
  singleton = adapter;
}

export function resetImageProcessingAdapterForTests(): void {
  singleton = null;
}
