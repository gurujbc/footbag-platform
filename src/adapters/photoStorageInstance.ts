import { config } from '../config/env';
import { LocalPhotoStorage } from './localPhotoStorage';
import { PhotoStorageAdapter } from './photoStorageAdapter';

let instance: PhotoStorageAdapter | null = null;

/**
 * Returns the singleton PhotoStorageAdapter for the current environment.
 *
 * Known deviation: production currently uses LocalPhotoStorage until S3
 * IAM credentials are wired for the Lightsail instance (NS-8 in iam.tf).
 */
export function getPhotoStorage(): PhotoStorageAdapter {
  if (!instance) {
    instance = new LocalPhotoStorage(config.mediaDir);
  }
  return instance;
}
