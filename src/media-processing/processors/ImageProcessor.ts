import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import type { FileType } from '@types';
import { sError } from 'sk-logger';

interface MediaOutput {
  fileType: FileType;
  originalFilename: string;
  originalSize: number;
  originalPath: string;
  width: number;
  height: number;
  thumbnailPath: string;
  thumbnailHeight: number;
  thumbnailWidth: number;
  mimeType: string;
}

class ImageProcessor {
  private filePaths: string[];

  constructor(filePath: string | string[]) {
    this.filePaths = Array.isArray(filePath) ? filePath : [filePath];
  }

  async process(): Promise<MediaOutput[]> {
    const processedFiles: MediaOutput[] = [];

    for (const filePath of this.filePaths) {
      const fullPath = path.resolve(filePath);
      const parsedFile = path.parse(fullPath);

      const IMAGES_DIR = 'images/';
      const THUMBNAILS_DIR = 'images/thumbnails/';
      const thumbnailFileName = `${parsedFile.name}-thumb.jpg`;
      const thumbnailFilePath = path.join(parsedFile.dir, 'thumbnails', thumbnailFileName);

      // Temporary file for compression
      const tempFilePath = `${fullPath}.tmp`;

      try {
        // Extract metadata before processing
        const metadata = await sharp(fullPath).metadata();
        const extractedMetadata = {
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
          space: metadata.space,
          channels: metadata.channels,
          density: metadata.density,
          hasAlpha: metadata.hasAlpha,
          exif: metadata.exif ? true : false, // We could parse EXIF further if needed
        };

        // Resize and compress original image (JPEG fallback)
        await sharp(fullPath)
          .resize(1080, null, { withoutEnlargement: true, fit: 'inside' })
          .jpeg({ quality: 75, progressive: true })
          .toFile(tempFilePath);

        // Generate WebP variant
        const webpFileName = `${parsedFile.name}.webp`;
        const webpPath = path.join(parsedFile.dir, webpFileName);
        await sharp(fullPath)
          .resize(1080, null, { withoutEnlargement: true, fit: 'inside' })
          .webp({ quality: 75 })
          .toFile(webpPath);

        // Generate AVIF variant (High quality, high compression)
        const avifFileName = `${parsedFile.name}.avif`;
        const avifPath = path.join(parsedFile.dir, avifFileName);
        try {
          await sharp(fullPath)
            .resize(1080, null, { withoutEnlargement: true, fit: 'inside' })
            .avif({ quality: 65 })
            .toFile(avifPath);
        } catch (avifErr) {
          sError('AVIF encoding failed (might be missing libavif):', avifErr);
        }

        // Overwrite original image with optimized JPEG
        await fs.rename(tempFilePath, fullPath);

        // Create thumbnail
        await sharp(fullPath)
          .resize(200, 200, { fit: 'cover' })
          .jpeg({ quality: 75 })
          .toFile(thumbnailFilePath);

        const stats = await fs.stat(fullPath);

        // Construct database-safe paths
        const originalDbPath = path.posix.join(IMAGES_DIR, parsedFile.base);
        const thumbnailDbPath = path.posix.join(THUMBNAILS_DIR, thumbnailFileName);
        const webpDbPath = path.posix.join(IMAGES_DIR, webpFileName);
        const avifDbPath = path.posix.join(IMAGES_DIR, avifFileName);

        processedFiles.push({
          fileType: 'image',
          originalFilename: parsedFile.name,
          originalSize: stats.size,
          originalPath: originalDbPath,
          mimeType: `image/${parsedFile.ext.replace('.', '')}`,
          width: metadata.width || 0,
          height: metadata.height || 0,
          thumbnailPath: thumbnailDbPath,
          thumbnailHeight: 200,
          thumbnailWidth: 200,
          metadata: extractedMetadata,
          webpPath: webpDbPath,
          avifPath: avifDbPath
        } as any);

      } catch (err) {
        sError(`Error processing image ${filePath}:`, err);
      } finally {
        // Cleanup in case of error
        try {
          await fs.unlink(tempFilePath);
        } catch { }
      }
    }

    return processedFiles;
  }
}

export default ImageProcessor;
