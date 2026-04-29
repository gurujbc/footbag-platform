import { randomUUID } from 'crypto';
import { media, transaction, ExistingAvatarRow } from '../db/db';
import { detectImageType } from '../lib/imageProcessing';
import { PhotoStorageAdapter } from '../adapters/photoStorageAdapter';
import { ImageProcessingAdapter } from '../adapters/imageProcessingAdapter';
import { ValidationError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export interface AvatarServiceDeps {
  storage: PhotoStorageAdapter;
  imageProcessor: ImageProcessingAdapter;
}

export function createAvatarService(deps: AvatarServiceDeps) {
  const { storage, imageProcessor } = deps;
  return {
    async uploadAvatar(memberId: string, fileBuffer: Buffer): Promise<{ thumbUrl: string }> {
      if (fileBuffer.length > AVATAR_MAX_BYTES) {
        throw new ValidationError('File is too large. Maximum size is 5 MB.');
      }

      // Cheap reject before crossing the worker process boundary; the worker
      // re-validates as defense-in-depth.
      const imageType = detectImageType(fileBuffer);
      if (!imageType) {
        throw new ValidationError('Only JPEG and PNG images are accepted.');
      }

      const processed = await imageProcessor.processAvatar(fileBuffer);

      const thumbKey = `avatars/${memberId}/thumb.jpg`;
      const displayKey = `avatars/${memberId}/display.jpg`;

      await storage.put(thumbKey, processed.thumb);
      await storage.put(displayKey, processed.display);

      const now = new Date().toISOString();
      const mediaId = randomUUID();

      // Delete old avatar (if any) and insert new one in a single transaction.
      // ON DELETE SET NULL on members.avatar_media_id handles detaching automatically.
      transaction(() => {
        const existing = runSqliteRead('getExistingAvatar', () =>
          media.getExistingAvatarMediaId.get(memberId),
        ) as ExistingAvatarRow | undefined;

        if (existing) {
          media.deleteMediaItem.run(existing.id);
        }

        media.insertMediaItem.run(
          mediaId, now, now,
          memberId, now,
          thumbKey, displayKey,
          processed.widthPx, processed.heightPx,
        );

        media.setMemberAvatar.run(mediaId, now, memberId);
      });

      return { thumbUrl: storage.constructURL(thumbKey) };
    },
  };
}
