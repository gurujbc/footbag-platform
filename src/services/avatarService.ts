import { randomUUID } from 'crypto';
import { media, transaction, ExistingAvatarRow } from '../db/db';
import { detectImageType, processAvatar } from '../lib/imageProcessing';
import { PhotoStorageAdapter } from '../adapters/photoStorageAdapter';
import { ValidationError } from './serviceErrors';
import { runSqliteRead } from './sqliteRetry';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export function createAvatarService(storage: PhotoStorageAdapter) {
  return {
    async uploadAvatar(memberId: string, fileBuffer: Buffer): Promise<{ thumbUrl: string }> {
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File is too large. Maximum size is 5 MB.');
      }

      const imageType = detectImageType(fileBuffer);
      if (!imageType) {
        throw new ValidationError('Only JPEG and PNG images are accepted.');
      }

      const processed = await processAvatar(fileBuffer);

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
