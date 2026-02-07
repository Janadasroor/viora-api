import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import type { FileType, VariantInput, VariantOutput } from '@types';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { sDebug, sError } from 'sk-logger';

const execPromise = promisify(exec);

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
  duration?: number;
  previewPath?: string;
  hlsPath?: string;
  resolutions?: {
    '1080p'?: string;
    '720p'?: string;
    '480p'?: string;
    '360p'?: string;
  };
}

interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
}

interface ResolutionVariant {
  path: string;
  width: number;
  height: number;
  size: number;
}
const VIDEOS_DIR = 'videos/';
class VideoProcessor {
  private filePaths: string[];

  constructor(filePath: string | string[]) {
    this.filePaths = Array.isArray(filePath) ? filePath : [filePath];
  }

  private getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          return reject(new Error(`Failed to probe video metadata: ${err.message}`));
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        if (!videoStream) {
          return reject(new Error('No video stream found in file'));
        }

        if (!videoStream.width || !videoStream.height) {
          return reject(new Error('Video dimensions not found'));
        }

        resolve({
          width: videoStream.width,
          height: videoStream.height,
          duration: metadata.format.duration || 0,
          hasAudio: !!audioStream
        });
      });
    });
  }

  private processResolution(
    inputPath: string,
    outputPath: string,
    height: number,
    hasAudio: boolean
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const options = [
        `-vf scale=-2:${height},format=yuv420p`,
        '-c:v libx264',
        '-crf 23',
        '-preset medium',
        '-max_error_rate 1'
      ];

      if (hasAudio) {
        options.push('-c:a aac', '-b:a 128k');
      }

      ffmpeg(inputPath)
        .outputOptions(options)
        .output(outputPath)
        .on('start', (commandLine) => {
          sDebug(`Processing ${height}p: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            sDebug(`${height}p progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', async () => {
          try {
            // Get the actual dimensions of the processed video
            const metadata = await this.getVideoMetadata(outputPath);
            resolve({ width: metadata.width, height: metadata.height });
          } catch (err) {
            reject(new Error(`Failed to get processed video metadata: ${err}`));
          }
        })
        .on('error', (err) => {
          reject(new Error(`Failed to process ${height}p resolution: ${err.message}`));
        })
        .run();
    });
  }

  private generateThumbnail(
    inputPath: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          count: 1,
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '640x?' // Better resolution for thumbnails
        })
        .on('end', () => {
          sDebug(`Thumbnail generated: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`Failed to generate thumbnail: ${err.message}`));
        });
    });
  }

  private generateHLS(
    inputPath: string,
    outputDir: string,
    resolutionsToProcess: { key: string; height: number }[]
  ): Promise<{ masterPlaylistPath: string; segmentPaths: string[] }> {
    return new Promise(async (resolve, reject) => {
      const segmentPaths: string[] = [];
      const masterPlaylistContent: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

      try {
        await fs.mkdir(outputDir, { recursive: true });

        for (const config of resolutionsToProcess) {
          const resDir = path.join(outputDir, config.key);
          await fs.mkdir(resDir, { recursive: true });

          const playlistName = `index.m3u8`;
          const playlistPath = path.join(resDir, playlistName);

          const bandwidth = config.height === 1080 ? 5000000 : config.height === 720 ? 2800000 : 1400000;
          const resolution = config.height === 1080 ? '1920x1080' : config.height === 720 ? '1280x720' : '854x480';

          masterPlaylistContent.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`);
          masterPlaylistContent.push(`${config.key}/${playlistName}`);

          await new Promise<void>((res, rej) => {
            ffmpeg(inputPath)
              .outputOptions([
                `-vf scale=-2:${config.height}`,
                '-c:v libx264',
                '-preset fast',
                '-g 48',
                '-sc_threshold 0',
                '-keyint_min 48',
                '-hls_time 4',
                '-hls_playlist_type vod',
                `-hls_segment_filename ${path.join(resDir, 'seg_%03d.ts')}`
              ])
              .output(playlistPath)
              .on('end', () => {
                sDebug(`HLS variant ${config.key} generated`);
                res();
              })
              .on('error', (err) => rej(err))
              .run();
          });
        }

        const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
        await fs.writeFile(masterPlaylistPath, masterPlaylistContent.join('\n'));
        resolve({ masterPlaylistPath, segmentPaths });
      } catch (err) {
        reject(err);
      }
    });
  }

  private generatePreview(
    inputPath: string,
    outputPath: string,
    duration: number,
    hasAudio: boolean
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const previewDuration = Math.min(10, duration);

      if (duration <= 0) {
        return reject(new Error('Invalid video duration for preview generation'));
      }

      const options = [
        '-vf scale=-2:480,format=yuv420p',
        '-c:v libx264',
        '-crf 28',
        '-preset fast',
        '-max_error_rate 1'
      ];

      if (hasAudio) {
        options.push('-c:a aac', '-b:a 96k');
      } else {
        options.push('-an'); // Explicitly disable audio if none exists
      }

      ffmpeg(inputPath)
        .setStartTime(0)
        .setDuration(previewDuration)
        .outputOptions(options)
        .output(outputPath)
        .on('start', (commandLine) => {
          sDebug(`Generating preview: ${commandLine}`);
        })
        .on('end', () => {
          sDebug(`Preview generated: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          reject(new Error(`Failed to generate preview: ${err.message}`));
        })
        .run();
    });
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (err) {
      throw new Error(`Failed to get file size for ${filePath}: ${err}`);
    }
  }

  async process(): Promise<{ media: MediaOutput; variants: VariantOutput[] }[]> {
    const results: { media: MediaOutput; variants: VariantOutput[] }[] = [];

    for (const filePath of this.filePaths) {
      try {
        sDebug(`\nProcessing video: ${filePath}`);

        const fullPath = path.join('', filePath);

        // Check if file exists
        try {
          await fs.access(fullPath);
        } catch {
          throw new Error(`File not found: ${fullPath}`);
        }

        const parsedPath = path.parse(fullPath);

        const thumbnailPath = path.join(
          parsedPath.dir,
          'thumbnails',
          `${parsedPath.name}-thumb.jpg`
        );

        const previewPath = path.join(
          parsedPath.dir,
          'previews',
          `${parsedPath.name}-preview.mp4`
        );

        // Ensure directories exist
        await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
        await fs.mkdir(path.dirname(previewPath), { recursive: true });

        // Get video metadata
        sDebug('Getting video metadata...');
        const metadata = await this.getVideoMetadata(fullPath);
        sDebug(`Video dimensions: ${metadata.width}x${metadata.height}, duration: ${metadata.duration}s`);

        // Generate thumbnail
        sDebug('Generating thumbnail...');
        await this.generateThumbnail(fullPath, thumbnailPath);

        // Generate preview
        sDebug('Generating preview...');
        await this.generatePreview(fullPath, previewPath, metadata.duration, metadata.hasAudio);

        // Generate resolutions
        const resolutions: { '1080p'?: string; '720p'?: string; '480p'?: string; '360p'?: string } = {};
        const resolutionVariants: Map<string, ResolutionVariant> = new Map();

        const resolutionConfigs = [
          { key: '1080p' as const, height: 1080 },
          { key: '720p' as const, height: 720 },
          { key: '480p' as const, height: 480 },
          { key: '360p' as const, height: 360 }
        ];

        for (const config of resolutionConfigs) {
          if (metadata.height >= config.height) {
            const resolutionPath = path.join(
              parsedPath.dir,
              'resolutions',
              `${parsedPath.name}-${config.key}.mp4`
            );


            await fs.mkdir(path.dirname(resolutionPath), { recursive: true });
            sDebug(`\nGenerating ${config.key} resolution...`);
            const dimensions = await this.processResolution(fullPath, resolutionPath, config.height, metadata.hasAudio);
            const fileSize = await this.getFileSize(resolutionPath);
            const resolutionDbPath = path.posix.join(VIDEOS_DIR, resolutionPath.split(parsedPath.dir)[1] || resolutionPath);
            resolutions[config.key] = resolutionPath;
            resolutionVariants.set(config.key, {
              path: resolutionDbPath,
              width: dimensions.width,
              height: dimensions.height,
              size: fileSize
            });

            sDebug(`${config.key} complete: ${dimensions.width}x${dimensions.height}, ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
          }
        }

        // Generate HLS
        sDebug('Generating HLS master and segments...');
        const hlsOutputDir = path.join(parsedPath.dir, 'hls');
        const hlsResult = await this.generateHLS(fullPath, hlsOutputDir,
          resolutionConfigs.filter(c => metadata.height >= c.height)
        );
        const hlsDbPath = path.posix.join(VIDEOS_DIR, hlsResult.masterPlaylistPath.split(parsedPath.dir)[1] || hlsResult.masterPlaylistPath);


        // Build variants array
        const variants: VariantOutput[] = [];

        for (const [resolution, variant] of resolutionVariants) {
          variants.push({
            resolution: resolution,
            width: variant.width,
            height: variant.height,
            fileFormat: 'mp4',
            filePath: variant.path,
            fileSize: variant.size,
            qualityLabel: resolution,
            codec: 'h264',
            bitrate: resolution === '720p' ? 2500 : resolution === '480p' ? 1000 : 500,
            container: 'mp4'
          });
        }

        const originalSize = await this.getFileSize(fullPath);
        const originalDbPath = path.posix.join(VIDEOS_DIR, parsedPath.base);
        const thumbnailDbPath = path.posix.join(VIDEOS_DIR, thumbnailPath.split(parsedPath.dir)[1] || thumbnailPath);
        const previewDbPath = path.posix.join(VIDEOS_DIR, previewPath.split(parsedPath.dir)[1] || previewPath);
        sDebug('originalPath::VIDEO', originalDbPath);
        results.push({
          media: {
            fileType: 'video',
            originalFilename: parsedPath.base,
            originalSize: originalSize,
            originalPath: originalDbPath,
            mimeType: 'video/' + parsedPath.ext.slice(1),
            width: metadata.width,
            height: metadata.height,
            thumbnailPath: thumbnailDbPath,
            thumbnailHeight: 200,
            thumbnailWidth: 200,
            duration: metadata.duration,
            previewPath: previewDbPath,
            hlsPath: hlsDbPath,
            resolutions
          },
          variants
        });

        sDebug(`\n✓ Successfully processed: ${filePath}`);
        sDebug(`  Generated ${variants.length} variant(s)`);

      } catch (error) {
        sError(`\n✗ Error processing ${filePath}:`, error);
        // Continue processing other files instead of throwing
        // If you want to stop on first error, uncomment the line below
        // throw error;
      }
    }

    if (results.length === 0 && this.filePaths.length > 0) {
      throw new Error('Failed to process any videos');
    }

    sDebug(`\n=== Processing Complete ===`);
    sDebug(`Successfully processed ${results.length}/${this.filePaths.length} video(s)`);

    return results;
  }
}

export default VideoProcessor;