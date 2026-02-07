import ffmpeg from 'fluent-ffmpeg';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { ENCODING_PROFILES } from '../config/encoding_profiles.js';
import { sError } from 'sk-logger';

interface ThumbnailSize {
  width: number;
  height: number;
}

interface ThumbnailSizes {
  small: ThumbnailSize;
  medium: ThumbnailSize;
  large: ThumbnailSize;
  [key: string]: ThumbnailSize;
}

interface GenerateFromVideoOptions {
  timestamps?: string[];
  sizes?: string[];
}

interface ThumbnailResult {
  timestamp?: string;
  size: string;
  path: string;
  fileSize: number;
  width: number;
  height: number;
}

export default class ThumbnailGenerator {
  private sizes: ThumbnailSizes;

  constructor() {
    this.sizes = ENCODING_PROFILES.thumbnail;
  }

  /**
   * Generate thumbnails from video at specific timestamps
   */
  async generateFromVideo(
    inputPath: string,
    outputDir: string,
    mediaId: string,
    options: GenerateFromVideoOptions = {}
  ): Promise<ThumbnailResult[]> {
    const {
      timestamps = ['00:00:01', '25%', '50%', '75%'], // Mix of absolute and percentage
      sizes = ['small', 'medium', 'large']
    } = options;

    const results: ThumbnailResult[] = [];

    for (const timestamp of timestamps) {
      const tempPath = path.join(
        outputDir,
        'temp',
        `${mediaId}_${timestamp.replace(/[:%]/g, '')}.jpg`
      );
      await fs.mkdir(path.dirname(tempPath), { recursive: true });

      try {
        // Extract frame from video
        await this.extractFrame(inputPath, tempPath, timestamp);

        // Resize to different sizes
        for (const sizeName of sizes) {
          const sizeConfig = this.sizes[sizeName];
          if (!sizeConfig) {
            throw new Error(`Unknown thumbnail size: ${sizeName}`);
          }
          const outputPath = path.join(
            outputDir,
            sizeName,
            `${mediaId}_${timestamp.replace(/[:%]/g, '')}.jpg`
          );

          await fs.mkdir(path.dirname(outputPath), { recursive: true });

          await sharp(tempPath)
            .resize(sizeConfig?.width, sizeConfig?.height, {
              fit: 'cover',
              position: 'center'
            })
            .jpeg({ quality: 85 })
            .toFile(outputPath);

          const stats = await fs.stat(outputPath);
          results.push({
            timestamp,
            size: sizeName,
            path: outputPath,
            fileSize: stats.size,
            width: sizeConfig.width,
            height: sizeConfig.height
          });
        }

        // Cleanup temp file
        await fs.unlink(tempPath);
      } catch (error) {
        sError(`Failed to generate thumbnail at ${timestamp}:`, error);
      }
    }

    return results;
  }

  /**
   * Extract a single frame from video
   */
  private async extractFrame(
    inputPath: string,
    outputPath: string,
    timestamp: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timestamp],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '1280x720' // Extract at decent quality, resize later
        })
        .on('end', () => resolve)
        .on('error', reject);
    });
  }

  /**
   * Generate thumbnails from uploaded image
   */
 async generateFromImage(inputPath: string, outputDir: string): Promise<ThumbnailResult[]> {
  const results: ThumbnailResult[] = [];

  // Overwrite original once (compress and normalize)
  await sharp(inputPath)
    .jpeg({ quality: 85 })
    .toFile(inputPath + ".tmp");

  await fs.rename(inputPath + ".tmp", inputPath);

  for (const [sizeName, { width, height }] of Object.entries(this.sizes)) {
    const filename = `${sizeName}-${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, filename);

    await sharp(inputPath)
      .resize(width, height, { fit: "cover", position: "center" })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    const stats = await fs.stat(outputPath);

    results.push({
      size: sizeName,
      path: outputPath,
      fileSize: stats.size,
      width,
      height
    });
  }

  return results;
}

  /**
   * Generate animated thumbnail/preview (GIF or short video)
   */
  async generateAnimatedPreview(
    inputPath: string,
    outputPath: string,
    duration: number = 3
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime('00:00:01')
        .setDuration(duration)
        .size('320x240')
        .fps(10)
        .output(outputPath)
        .on('end', () => resolve)
        .on('error', reject)
        .run();
    });
  }
}