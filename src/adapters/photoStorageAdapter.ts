/**
 * PhotoStorageAdapter interface.
 *
 * Abstracts photo storage between environments. Production will use S3;
 * development and current staging use local filesystem with identical
 * key structure. Services call this interface; infrastructure routes to
 * the appropriate implementation based on environment.
 */

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
