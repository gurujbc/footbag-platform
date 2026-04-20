/**
 * PhotoStorageAdapter: interface + implementations + singleton getter for the
 * adapters layer. Abstracts photo storage
 * between environments. Production will use S3 (future
 * `createS3PhotoStorageAdapter`); development and current staging use local
 * filesystem via `createLocalPhotoStorageAdapter` with identical key
 * structure. Services call the interface; the getter returns the
 * configured implementation.
 */
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import * as path from 'node:path';
import { config } from '../config/env';

export interface PhotoStorageAdapter {
  /** Write data to the given storage key, creating directories as needed. */
  put(key: string, data: Buffer): Promise<void>;

  /** Delete the object at the given storage key. No-op if it does not exist. */
  delete(key: string): Promise<void>;

  /** Return a URL suitable for use in templates (e.g. `/media/{key}` or a CloudFront URL). */
  constructURL(key: string): string;

  /** Check whether an object exists at the given storage key. */
  exists(key: string): Promise<boolean>;
}

export function createLocalPhotoStorageAdapter(opts: {
  baseDir: string;
}): PhotoStorageAdapter {
  const { baseDir } = opts;
  return {
    async put(key: string, data: Buffer): Promise<void> {
      const filePath = path.join(baseDir, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    },
    async delete(key: string): Promise<void> {
      const filePath = path.join(baseDir, key);
      try {
        await unlink(filePath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
    constructURL(key: string): string {
      return `/media/${key}`;
    },
    async exists(key: string): Promise<boolean> {
      try {
        await access(path.join(baseDir, key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

let singleton: PhotoStorageAdapter | null = null;

export function getPhotoStorageAdapter(): PhotoStorageAdapter {
  if (!singleton) {
    singleton = createLocalPhotoStorageAdapter({ baseDir: config.mediaDir });
  }
  return singleton;
}

export function resetPhotoStorageAdapterForTests(): void {
  singleton = null;
}
