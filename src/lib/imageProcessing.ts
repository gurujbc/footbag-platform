import sharp from 'sharp';

const THUMB_SIZE = 300;
const DISPLAY_WIDTH = 800;
const JPEG_QUALITY = 85;

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export interface ProcessedImage {
  thumb: Buffer;
  display: Buffer;
  widthPx: number;
  heightPx: number;
}

/**
 * Validate that the buffer starts with JPEG or PNG magic bytes.
 * Returns the detected MIME type, or null if unrecognized.
 */
export function detectImageType(data: Buffer): 'image/jpeg' | 'image/png' | null {
  if (data.length < 4) return null;
  if (data.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (data.subarray(0, 4).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

/**
 * Process a raw upload buffer into two JPEG variants.
 *
 * Security: re-encodes the image through sharp, which strips all
 * EXIF/ICC/XMP metadata and eliminates any embedded malicious content.
 * The original bytes are never written to disk.
 *
 * Returns a 300x300 thumbnail (cover crop) and an 800px-wide display
 * variant, both as JPEG at 85% quality.
 */
export async function processAvatar(data: Buffer): Promise<ProcessedImage> {
  const metadata = await sharp(data).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('Unable to read image dimensions');
  }

  const [thumb, display] = await Promise.all([
    sharp(data)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .rotate()
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer(),

    sharp(data)
      .resize(DISPLAY_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
      .rotate()
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer(),
  ]);

  return { thumb, display, widthPx: width, heightPx: height };
}
