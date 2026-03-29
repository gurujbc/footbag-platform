import { mkdir, writeFile, unlink, access } from 'fs/promises';
import path from 'path';
import { PhotoStorageAdapter } from './photoStorageAdapter';

/**
 * Local filesystem implementation of PhotoStorageAdapter.
 *
 * Stores files under `{baseDir}/{key}`. Directory structure mirrors
 * what will become S3 object key prefixes, so keys are directly
 * reusable when migrating to S3.
 *
 * Known deviation: used in production until S3 IAM credentials are wired.
 */
export class LocalPhotoStorage implements PhotoStorageAdapter {
  constructor(private readonly baseDir: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  constructURL(key: string): string {
    return `/media/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(path.join(this.baseDir, key));
      return true;
    } catch {
      return false;
    }
  }
}
