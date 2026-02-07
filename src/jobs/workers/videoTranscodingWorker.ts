/*const Worker = require('bullmq').Worker;
const VideoProcessor = require('../../media-processing/processors/VideoProcessor.js').VideoProcessor;
const ThumbnailGenerator = require('../../media-processing/processors/ThumbnailGenerator.js').ThumbnailGenerator;
const MediaRepository = require('../../repositories/MediaRepository.js').MediaRepository;
const redis = require('../../config/redis_config.js');
const path = require('path');

const videoProcessor = new VideoProcessor();
const thumbnailGenerator = new ThumbnailGenerator();
const mediaRepo = new MediaRepository();

 const videoTranscodingWorker = new Worker(
  'video-transcoding',
  async (job) => {
    const { mediaId, inputPath, userId } = job.data;

    try {
      // Update status
      await mediaRepo.updateStatus(mediaId, 'processing');

      // Process video to multiple resolutions
      const outputDir = path.join(process.cwd(), 'uploads', 'videos');
      
      const { results, metadata } = await videoProcessor.processVideo(
        inputPath,
        outputDir,
        mediaId,
        (progress) => {
          job.updateProgress(progress);
        }
      );

      // Save video variants to database
      for (const variant of results) {
        if (variant.status === 'completed') {
          await mediaRepo.createVideoVariant({
            media_id: mediaId,
            resolution: variant.resolution,
            width: videoProcessor.profiles[variant.resolution].width,
            height: videoProcessor.profiles[variant.resolution].height,
            file_path: variant.path,
            file_size: variant.size,
            status: 'ready'
          });
        }
      }

      // Generate thumbnails
      const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
      const thumbnails = await thumbnailGenerator.generateFromVideo(
        inputPath,
        thumbnailDir,
        mediaId
      );

      // Save thumbnails to database
      for (const thumb of thumbnails) {
        await mediaRepo.createThumbnail({
          media_id: mediaId,
          type: 'auto',
          size: thumb.size,
          file_path: thumb.path,
          file_size: thumb.fileSize,
          width: thumb.width,
          height: thumb.height,
          timestamp_ms: 1000, // Placeholder
          is_primary: thumb.timestamp === '00:00:01' && thumb.size === 'medium'
        });
      }

      // Update media record
      await mediaRepo.update(mediaId, {
        status: 'ready',
        processing_progress: 100,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
        fps: metadata.fps
      });

      return { success: true, variants: results.length, thumbnails: thumbnails.length };
    } catch (error) {
      await mediaRepo.updateStatus(mediaId, 'failed');
      await mediaRepo.update(mediaId, { processing_error: error.message });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2, // Process 2 videos at a time
    limiter: {
      max: 5,
      duration: 60000 // Max 5 jobs per minute
    }
  }
);

videoTranscodingWorker.on('completed', (job) => {
});

videoTranscodingWorker.on('failed', (job, err) => {
  console.error(`Video ${job.data.mediaId} failed:`, err);
});

module.exports = videoTranscodingWorker;
*/