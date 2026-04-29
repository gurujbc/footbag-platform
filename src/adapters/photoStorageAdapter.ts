/**
 * PhotoStorageAdapter: interface + implementations + singleton getter for the
 * adapters layer. Abstracts photo storage between environments. Production
 * uses S3 (`createS3PhotoStorageAdapter`); development and pre-cutover
 * staging use the local filesystem (`createLocalPhotoStorageAdapter`) with
 * identical key structure. Both implementations return relative `/media/{key}`
 * URLs from `constructURL`; routing to S3 vs Lightsail-served local fs is
 * handled by the CloudFront `/media/*` cache behavior. Services call the
 * interface; the getter returns the configured implementation based on
 * `config.photoStorageAdapter`.
 */
import { mkdir, writeFile, unlink, access } from 'node:fs/promises';
import * as path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
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

export function createS3PhotoStorageAdapter(opts: {
  bucket: string;
  region?: string;
  s3Client?: S3Client;
}): PhotoStorageAdapter {
  const client =
    opts.s3Client ?? new S3Client(opts.region ? { region: opts.region } : {});
  const bucket = opts.bucket;
  return {
    async put(key: string, data: Buffer): Promise<void> {
      // URL-versioning via `?v={media_id}` makes the bytes-at-this-URL
      // immutable from any cache's point of view; a replacement upload
      // emits a fresh `?v=` and is a distinct cache key.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },
    async delete(key: string): Promise<void> {
      // S3 DeleteObject is idempotent: it returns success whether or not the
      // key existed. No special-case for a missing key.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    constructURL(key: string): string {
      return `/media/${key}`;
    },
    async exists(key: string): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'NotFound') return false;
        throw err;
      }
    },
  };
}

let singleton: PhotoStorageAdapter | null = null;

export function getPhotoStorageAdapter(): PhotoStorageAdapter {
  if (singleton) return singleton;
  if (config.photoStorageAdapter === 's3') {
    singleton = createS3PhotoStorageAdapter({
      bucket: config.photoStorageS3Bucket as string,
      region: config.awsRegion,
    });
  } else {
    singleton = createLocalPhotoStorageAdapter({ baseDir: config.mediaDir });
  }
  return singleton;
}

export function setPhotoStorageAdapterForTests(adapter: PhotoStorageAdapter): void {
  singleton = adapter;
}

export function resetPhotoStorageAdapterForTests(): void {
  singleton = null;
}
