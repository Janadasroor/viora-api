
import { Worker } from 'bullmq';
import mediaRepository from '../../repositories/MediaRepository.js';
import redisService from '../../cache/RedisService.js';
import { redisConnection } from "../index.js";
import ImageProcessor from '../../media-processing/processors/ImageProcessor.js';
import VideoProcessor from '../../media-processing/processors/VideoProcessor.js';
import postsRepository from '../../repositories/PostsRepository.js';
import reelRepository from '../../repositories/ReelRepository.js';
import storiesRepository from '../../repositories/StoriesRepository.js';
import notificationsService from '../../services/NotificationsService.js';
import { createFirebaseStorage } from '../../storage/StorageService.js';
import { bucket } from '../../config/firebase.config.js';
import fs from 'fs';
import type { MediaRequest, MediaInput, VariantInput, VariantOutput } from '@types';
import { fileURLToPath } from 'url';
import path from 'path';
import { sDebug, sError, sInfo } from 'sk-logger';
import vectorEmbeddingService from '../../services/VectorEmbeddingService.js';
import type { EmbeddingResult, MultiModalEmbeddingResult } from '../../services/VectorEmbeddingService.js';
import qdrantService from '../../services/QdrantService.js';
import { getIO } from '../../utils/socketManager.js';
import "dotenv"
const __filename = path.dirname(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const uploadPath = path.join(__dirname, '../../uploads/');
const connection = redisConnection();
const storage = createFirebaseStorage({ bucket });

// Batch size for parallel operations
const UPLOAD_BATCH_SIZE = 10;
const NOTIFICATION_BATCH_SIZE = 100;

/**
 * Helper function to process items in batches with Promise.all
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Send notifications to followers in batches
 */
async function notifyFollowers(
  userId: string,
  targetType: string,
  targetId: string,
  notificationType: "new_post" | "new_story" | "new_reel" | "like" | "comment"
): Promise<void> {
  try {
    const userRepository = (await import('../../repositories/UserRepository.js')).default;
    const followers = await userRepository.getFollowers(userId, 1, 1000);

    if (followers.length === 0) return;

    // Process notifications in batches for better performance
    await processBatch(
      followers,
      NOTIFICATION_BATCH_SIZE,
      async (follower) => {
        await notificationsService.notify({
          recipientId: follower.userId,
          actorId: userId,
          notificationType: notificationType,
          targetType: targetType.toLowerCase(),
          targetId: targetId,
          useAggregation: true
        });
      }
    );

    sDebug(`✓ Queued ${followers.length} notifications for ${targetType}`);
  } catch (err) {
    sError(`Failed to queue ${targetType} notifications:`, err);
  }
}

/**
 * Upload media files to storage in parallel batches
 */
async function uploadMediaFiles(
  files: Array<{ localPath: string; remotePath: string }>
): Promise<void> {
  await processBatch(
    files,
    UPLOAD_BATCH_SIZE,
    async (file) => {
      const result = await storage.uploadFromPath(
        path.join(uploadPath, file.localPath),
        file.remotePath
      );
      sDebug(`✓ Uploaded: ${file.remotePath}`);
      return result;
    }
  );
}

/**
 * Get all files in a directory recursively
 */
async function getFilesRecursively(dir: string, baseDir: string): Promise<Array<{ localPath: string; remotePath: string }>> {
  const files: Array<{ localPath: string; remotePath: string }> = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFilesRecursively(fullPath, baseDir)));
    } else {
      const relativePath = path.relative(baseDir, fullPath);
      files.push({ localPath: relativePath, remotePath: relativePath });
    }
  }
  return files;
}

/**
 * Safely delete files from local uploads folder
 */
async function cleanupFiles(files: string[]): Promise<void> {
  const uniqueFiles = [...new Set(files)];
  await Promise.all(
    uniqueFiles.map(async (file) => {
      try {
        const fullPath = path.join(uploadPath, file);
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          sDebug(`✓ Deleted local file: ${file}`);
        }
      } catch (err) {
        sError(`Failed to delete local file ${file}:`, err);
      }
    })
  );
}

/**
 * Process image media job
 */
async function processImageJob(media: MediaRequest): Promise<void> {
  if (media.images.length === 0) return;


  const imageProcessor = new ImageProcessor(media.images);
  const processedImages = await imageProcessor.process();


  const mediaInputs = processedImages.map((image: any) => {
    sDebug(`Image Paths: webp=${image.webpPath}, avif=${image.avifPath}`);
    return {
      type: image.fileType,
      originalFilename: image.originalFilename,
      originalSize: image.originalSize,
      originalPath: image.originalPath,
      width: image.width,
      height: image.height,
      thumbnailPath: image.thumbnailPath,
      thumbnailHeight: image.thumbnailHeight,
      thumbnailWidth: image.thumbnailWidth,
      mimeType: image.mimeType,
      metadata: {
        ...image.metadata,
        webp_path: image.webpPath,
        avif_path: image.avifPath
      }
    };
  }) as MediaInput[];


  const insertedMedia = await mediaRepository.create(mediaInputs, media.userId);
  const targetId = media.targetId;
  const targetType = media.targetType.toUpperCase();


  // Generate and store embeddings for each image (must be done before upload/move)
  const useMultimodal = process.env.USE_MULTIMODAL_EMBEDDINGS === 'true';
  const isLazyMode = process.env.LAZY_EMBEDDING_MODE === 'true';

  if (isLazyMode) {
    sInfo(`Lazy Embedding Mode enabled. Skipping real-time embedding for ${processedImages.length} images.`);
  } else {
    for (let i = 0; i < processedImages.length; i++) {
      const image = processedImages[i];
      const mediaId = insertedMedia[i]?.id;

      if (!image || !mediaId) continue;

      try {
        sDebug(`Generating embedding and NSFW safety scores for image ${mediaId}...`);

        if (useMultimodal) {
          sInfo(`Generating embedding using multimodal for media ${mediaId}: ${image.originalPath}`);
          // Use new multi-modal endpoint
          const multimodalResult = await vectorEmbeddingService.generateMultiModalEmbedding(
            path.join(uploadPath, image.originalPath)
          );

          if (multimodalResult) {
            try {
              await qdrantService.upsertMultimodalVector(
                mediaId,
                multimodalResult.visual_embedding,
                multimodalResult.vision_embedding, // New ViT vision embedding
                multimodalResult.text_embedding,
                {
                  type: 'image',
                  targetType: targetType,
                  targetId: targetId,
                  userId: media.userId,
                  nsfw: {
                    predictions: multimodalResult.predictions,
                    top_label: multimodalResult.top_label,
                    probability: multimodalResult.probability
                  },
                  content_type: multimodalResult.content_type,
                  alignment_score: multimodalResult.alignment_score,
                  ocr_text: multimodalResult.ocr_text,
                  caption: multimodalResult.caption
                }
              );

              // Store label in PostgreSQL for efficient filtering in feed queries
              await mediaRepository.updateNSFWLabel(mediaId, multimodalResult.top_label);
              sInfo(`✓ Successfully processed multimodal embedding for media ${mediaId} (including ViT vision)`);
            } catch (qdrantError) {
              sError(`Failed to store multimodal embedding in Qdrant for media ${mediaId}:`, qdrantError);
              // Continue processing other images even if one fails
            }
          } else {
            sError(`Failed to generate multimodal embedding for media ${mediaId}. Attempting fallback to legacy method.`);
            // Fallback to legacy embedding if multimodal fails
            // Only try fallback if the error wasn't a connection issue (service might be down)
            try {
              const legacyResult = await vectorEmbeddingService.generateImageEmbedding(
                path.join(uploadPath, image.originalPath)
              );
              if (legacyResult) {
                await qdrantService.upsertMediaVector(mediaId, legacyResult.embedding, {
                  type: 'image',
                  targetType: targetType,
                  targetId: targetId,
                  userId: media.userId,
                  nsfw: {
                    predictions: legacyResult.predictions,
                    top_label: legacyResult.top_label,
                    probability: legacyResult.probability
                  }
                });
                await mediaRepository.updateNSFWLabel(mediaId, legacyResult.top_label);
                sInfo(`✓ Fallback: Successfully processed legacy embedding for media ${mediaId}`);
              } else {
                sError(`✗ Both multimodal and legacy embedding failed for media ${mediaId}. Embedding service may be unavailable.`);
              }
            } catch (fallbackError) {
              sError(`✗ Fallback to legacy embedding also failed for media ${mediaId}:`, fallbackError);
              // Don't throw - continue processing other images
            }
          }
        } else {
          // Legacy endpoint for backward compatibility
          const result = await vectorEmbeddingService.generateImageEmbedding(path.join(uploadPath, image.originalPath));

          if (result) {
            await qdrantService.upsertMediaVector(mediaId, result.embedding, {
              type: 'image',
              targetType: targetType,
              targetId: targetId,
              userId: media.userId,
              nsfw: {
                predictions: result.predictions,
                top_label: result.top_label,
                probability: result.probability
              }
            });

            // Store label in PostgreSQL for efficient filtering in feed queries
            await mediaRepository.updateNSFWLabel(mediaId, result.top_label);
          }
        }
      } catch (err) {
        sError(`Failed to process embedding for image ${mediaId}:`, err);
      }
    }
  }

  sInfo(`Target: ${targetType}:${targetId}`);

  if (!targetId || !targetType || targetType === "REEL") return;

  const mediaIds = insertedMedia.map((input) => input.id);

  // Prepare upload files
  const uploadFiles = processedImages.flatMap((image: any) => [
    { localPath: image.originalPath, remotePath: image.originalPath },
    { localPath: image.thumbnailPath, remotePath: image.thumbnailPath },
    { localPath: image.webpPath, remotePath: image.webpPath },
    { localPath: image.avifPath, remotePath: image.avifPath }
  ]);

  // Upload all files in parallel batches

  await uploadMediaFiles(uploadFiles);

  // Clean up local files after upload (optional but recommended)
  await cleanupFiles(uploadFiles.map(f => f.localPath));

  // Insert media associations
  if (targetType === "POST") {
    await postsRepository.insertPostMedia(targetId, mediaIds);
  } else if (targetType === "STORY") {
    await storiesRepository.insertStoryMedia(targetId, mediaIds);
  } else if (targetType === "USER") {
    const userRepository = (await import('../../repositories/UserRepository.js')).default;
    // Insert user media in parallel
    await Promise.all(
      mediaIds.map((mediaId) => userRepository.insertUserMedia(targetId, mediaId))
    );
  }

  // Send notifications asynchronously (don't await)
  if (targetType === "POST") {
    notifyFollowers(media.userId, 'post', targetId, 'new_post').catch(err =>
      sError('Notification error:', err)
    );
  } else if (targetType === "STORY") {
    notifyFollowers(media.userId, 'story', targetId, 'new_story').catch(err =>
      sError('Notification error:', err)
    );
  } else if (targetType === "USER") {
    // Profile update notifications (direct, not aggregated)
    (async () => {
      try {
        const userRepository = (await import('../../repositories/UserRepository.js')).default;
        const followers = await userRepository.getFollowers(targetId, 1, 1000);

        await processBatch(
          followers,
          NOTIFICATION_BATCH_SIZE,
          async (follower) => {
            await notificationsService.notify({
              recipientId: follower.userId,
              actorId: targetId,
              notificationType: 'profile_update',
              targetType: 'user',
              targetId: targetId,
              message: 'updated their profile picture',
              sendPush: true
            });
          }
        );
      } catch (err) {
        sError('Profile update notification error:', err);
      }
    })();
  }

  // Update status to 'ready' and notify user via Socket.IO
  try {
    const io = getIO();
    const mediaIds = insertedMedia.map(m => m.id);

    // Update status in DB
    await Promise.all(mediaIds.map(id =>
      mediaRepository.updateProcessingStatus(id, 'ready')
    ));

    // Emit socket event
    io.to(`user_${media.userId}`).emit('media_ready', {
      targetId,
      targetType,
      mediaIds: mediaIds,
      mediaType: 'image'
    });

    // Create DB notification and send push
    notificationsService.notify({
      recipientId: media.userId,
      actorId: media.userId,
      notificationType: 'mediaReady',
      targetType: targetType.toLowerCase(),
      targetId: targetId,
      message: `Your ${targetType.toLowerCase()} is ready to view!`,
      sendPush: true
    }).catch(err => sError('Failed to create mediaReady notification:', err));
    sDebug(`✓ Emitted media_ready event to user_${media.userId}`);

    // Update content status to 'published'
    if (targetType === 'POST') await postsRepository.updatePostStatus(targetId, 'published');
    if (targetType === 'STORY') await storiesRepository.updateStoryStatus(targetId, 'published');
    if (targetType === 'REEL') await reelRepository.updateReelStatus(targetId, 'published');

  } catch (err) {
    sError('Failed to update status or emit socket event:', err);
  }

  sDebug(`✓ Image job completed for ${targetType}:${targetId}`);

  // Cleanup local files
  const filesToCleanup = uploadFiles.map(f => f.localPath);
  await cleanupFiles(filesToCleanup);
}


/**
 * Emits a progress event to the user via Socket.IO
 */
async function emitProgress(
  userId: string,
  targetId: string,
  targetType: string,
  progress: number,
  status: string
) {
  try {
    const io = getIO();
    io.to(`user_${userId}`).emit('media_processing_progress', {
      targetId,
      targetType,
      progress,
      status
    });
  } catch (err) {
    // Sockets might not be initialized in some contexts, or other errors
    sError('Failed to emit progress:', err);
  }
}

/**
 * Process video media job
 */
async function processVideoJob(media: MediaRequest): Promise<void> {
  if (media.videos.length === 0) {
    sDebug('No videos to process');
    return;
  }

  const targetId = media.targetId;
  const targetType = media.targetType.toUpperCase();

  await emitProgress(media.userId, targetId, targetType, 5, 'Starting video processing...');

  // Process videos
  const videoProcessor = new VideoProcessor(media.videos);
  const processedVideos = await videoProcessor.process();

  if (processedVideos.length === 0) {
    sDebug('No videos were processed successfully');
    await emitProgress(media.userId, targetId, targetType, 0, 'Video processing failed');
    return;
  }

  await emitProgress(media.userId, targetId, targetType, 40, 'Transcoding complete. Analyzing content...');

  // Prepare media inputs
  const mediaInputs: MediaInput[] = processedVideos.map((video) => ({
    type: video.media.fileType,
    originalFilename: video.media.originalFilename,
    originalSize: video.media.originalSize,
    originalPath: video.media.originalPath,
    width: video.media.width,
    height: video.media.height,
    thumbnailPath: video.media.thumbnailPath,
    thumbnailHeight: video.media.thumbnailHeight,
    thumbnailWidth: video.media.thumbnailWidth,
    mimeType: video.media.mimeType,
    hlsPath: video.media.hlsPath
  })) as any;

  // Insert media records
  const insertedMedia = await mediaRepository.create(mediaInputs, media.userId);
  sDebug(`✓ Inserted ${insertedMedia.length} media records`);

  const mediaIds = insertedMedia.map((input) => input.id);

  // Generate and store embeddings for each video (must be done before upload/move)
  const useMultimodal = process.env.USE_MULTIMODAL_EMBEDDINGS === 'true';
  const isLazyMode = process.env.LAZY_EMBEDDING_MODE === 'true';

  if (isLazyMode) {
    sInfo(`Lazy Embedding Mode enabled. Skipping real-time embedding for ${processedVideos.length} videos.`);
  } else {
    for (let i = 0; i < processedVideos.length; i++) {
      const video = processedVideos[i];
      const mediaId = insertedMedia[i]?.id;

      if (!video || !mediaId) continue;

      try {
        sDebug(`Generating embedding and NSFW safety scores for video ${mediaId}...`);
        await emitProgress(media.userId, targetId, targetType, 40 + Math.floor((i / processedVideos.length) * 20), `Analyzing video ${i + 1}/${processedVideos.length}...`);

        if (useMultimodal) {
          // Use new multi-modal endpoint
          const multimodalResult = await vectorEmbeddingService.generateMultiModalVideoEmbedding(
            path.join(uploadPath, video.media.originalPath)
          );

          if (multimodalResult) {
            await qdrantService.upsertMultimodalVector(
              mediaId,
              multimodalResult.visual_embedding,
              multimodalResult.vision_embedding, // New ViT vision embedding
              multimodalResult.text_embedding,
              {
                type: 'video',
                targetType: targetType,
                targetId: targetId,
                userId: media.userId,
                nsfw: {
                  predictions: multimodalResult.predictions,
                  top_label: multimodalResult.top_label,
                  probability: multimodalResult.probability
                },
                content_type: multimodalResult.content_type,
                alignment_score: multimodalResult.alignment_score,
                ocr_text: multimodalResult.ocr_text,
                caption: multimodalResult.caption
              }
            );

            // Store label in PostgreSQL for efficient filtering in feed queries
            await mediaRepository.updateNSFWLabel(mediaId, multimodalResult.top_label);
          }
        } else {
          // Legacy endpoint for backward compatibility
          const result = await vectorEmbeddingService.generateVideoEmbedding(path.join(uploadPath, video.media.originalPath));

          if (result) {
            await qdrantService.upsertMediaVector(mediaId, result.embedding, {
              type: 'video',
              targetType: targetType,
              targetId: targetId,
              userId: media.userId,
              nsfw: {
                predictions: result.predictions,
                top_label: result.top_label,
                probability: result.probability
              }
            });

            // Store label in PostgreSQL for efficient filtering in feed queries
            await mediaRepository.updateNSFWLabel(mediaId, result.top_label);
          }
        }
      } catch (err) {
        sError(`Failed to process embedding for video ${mediaId}:`, err);
      }
    }
  }

  await emitProgress(media.userId, targetId, targetType, 70, 'Analysis complete. Finalizing uploads...');

  // Prepare all upload files (videos, thumbnails, previews, variants)
  const uploadFiles: Array<{ localPath: string; remotePath: string }> = [];

  processedVideos.forEach((video) => {
    uploadFiles.push(
      { localPath: video.media.originalPath, remotePath: video.media.originalPath },
      { localPath: video.media.thumbnailPath, remotePath: video.media.thumbnailPath }
    );

    if (video.media.previewPath) {
      uploadFiles.push({
        localPath: video.media.previewPath,
        remotePath: video.media.previewPath
      });
    }

    video.variants.forEach((variant) => {
      uploadFiles.push({
        localPath: variant.filePath,
        remotePath: variant.filePath
      });
    });
  });

  // Collect HLS files recursively
  for (const video of processedVideos) {
    if (video.media.hlsPath) {
      const hlsFullDir = path.join(uploadPath, path.dirname(video.media.hlsPath));
      const hlsFiles = await getFilesRecursively(hlsFullDir, uploadPath);
      uploadFiles.push(...hlsFiles);
    }
  }

  // Upload all files in parallel batches
  await uploadMediaFiles(uploadFiles);

  // Clean up local files after upload
  await cleanupFiles(uploadFiles.map(f => f.localPath));

  await emitProgress(media.userId, targetId, targetType, 90, 'Uploads complete. Finalizing...');

  // Prepare variant inputs
  const variants: VariantInput[] = [];
  processedVideos.forEach((video, index) => {
    const mediaId = insertedMedia[index].id;

    video.variants.forEach((variant) => {
      variants.push({
        mediaId: mediaId,
        resolution: variant.resolution,
        width: variant.width,
        height: variant.height,
        qualityLabel: variant.qualityLabel,
        filePath: variant.filePath,
        fileSize: variant.fileSize,
        fileFormat: variant.fileFormat,
        codec: variant.codec,
        bitrate: variant.bitrate,
        container: variant.container,
        status: 'completed'
      });
    });
  });

  // Insert media associations and variants in parallel
  const insertionPromises: Promise<any>[] = [];

  if (targetType === "POST") {
    insertionPromises.push(postsRepository.insertPostMedia(targetId, mediaIds));
  } else if (targetType === "REEL") {
    insertionPromises.push(reelRepository.insertReelMedia(targetId, mediaIds));
  } else if (targetType === "STORY") {
    insertionPromises.push(storiesRepository.insertStoryMedia(targetId, mediaIds));
  }

  if (variants.length > 0) {
    insertionPromises.push(mediaRepository.createVariant(variants));
  }

  await Promise.all(insertionPromises);

  if (variants.length > 0) {
    sDebug(`✓ Inserted ${variants.length} video variants`);
  }

  // Send notifications asynchronously (don't await)
  if (targetType === "POST") {
    notifyFollowers(media.userId, 'post', targetId, 'new_post').catch(err =>
      sError('Notification error:', err)
    );
  } else if (targetType === "REEL") {
    notifyFollowers(media.userId, 'reel', targetId, 'new_reel').catch(err =>
      sError('Notification error:', err)
    );
  } else if (targetType === "STORY") {
    notifyFollowers(media.userId, 'story', targetId, 'new_story').catch(err =>
      sError('Notification error:', err)
    );
  }

  // Update status to 'ready' and notify user via Socket.IO
  try {
    const io = getIO();

    // Update status in DB
    await Promise.all(mediaIds.map(id =>
      mediaRepository.updateProcessingStatus(id, 'ready')
    ));

    // Emit socket event
    io.to(`user_${media.userId}`).emit('media_ready', {
      targetId,
      targetType,
      mediaIds: mediaIds,
      mediaType: 'video'
    });

    await emitProgress(media.userId, targetId, targetType, 100, 'Processing complete!');

    // Create DB notification and send push
    notificationsService.notify({
      recipientId: media.userId,
      actorId: media.userId,
      notificationType: 'mediaReady',
      targetType: targetType.toLowerCase(),
      targetId: targetId,
      message: `Your ${targetType.toLowerCase()} is ready to view!`,
      sendPush: true
    }).catch(err => sError('Failed to create mediaReady notification:', err));
    sDebug(`✓ Emitted media_ready event to user_${media.userId}`);

    // Update content status to 'published'
    if (targetType === 'POST') await postsRepository.updatePostStatus(targetId, 'published');
    if (targetType === 'STORY') await storiesRepository.updateStoryStatus(targetId, 'published');
    if (targetType === 'REEL') await reelRepository.updateReelStatus(targetId, 'published');

  } catch (err) {
    sError('Failed to update status or emit socket event:', err);
  }

  sDebug(`✓ Video job completed: ${processedVideos.length} videos processed`);

  // Cleanup local files
  const filesToCleanup = uploadFiles.map(f => f.localPath);
  await cleanupFiles(filesToCleanup);
}

/**
 * Main job processor
 */
async function processJob(job: any): Promise<void> {
  const startTime = Date.now();



  try {
    if (job.name === 'image-processing') {
      await processImageJob(job.data as MediaRequest);
    } else if (job.name === 'video-processing') {
      await processVideoJob(job.data as MediaRequest);
    }

    const duration = Date.now() - startTime;
    sDebug(`✓ Job ${job.name} completed in ${duration}ms`);
  } catch (error) {

    sError(`✗ Error in ${job.name}:`, error);
    throw error;
  }
}

// Create worker with optimized concurrency
const mediaWorker = new Worker(
  'mediaQueue',
  async (job) => {
    await processJob(job);
  },
  {
    connection,
    concurrency: 20, // Increased from 5 to 20 for better throughput
    limiter: {
      max: 100, // Max 100 jobs per duration
      duration: 1000, // Per second
    },
  }
);

mediaWorker.on('completed', (job) => {
  sDebug('✓ Media job completed:', job.id);
});

mediaWorker.on('failed', async (job, err) => {
  sError('✗ Media job failed:', job?.id, err);
  if (job?.data) {
    const data = job.data as MediaRequest;
    const targetId = data.targetId;
    const targetType = data.targetType.toUpperCase();

    try {
      if (targetType === 'POST') await postsRepository.updatePostStatus(targetId, 'failed');
      if (targetType === 'STORY') await storiesRepository.updateStoryStatus(targetId, 'failed');
      if (targetType === 'REEL') await reelRepository.updateReelStatus(targetId, 'failed');
      sDebug(`✗ Marked ${targetType}:${targetId} as failed`);
    } catch (updateErr) {
      sError('Failed to update content status for failed job:', updateErr);
    }
  }
});

mediaWorker.on('error', (err) => {
  sError('✗ Worker error:', err);
});

export default mediaWorker;
