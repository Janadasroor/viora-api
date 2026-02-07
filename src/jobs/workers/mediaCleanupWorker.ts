import { Worker } from 'bullmq';
import mediaRepository from '../../repositories/MediaRepository.js';
import redisService from '../../cache/RedisService.js';
import { redisConnection } from "../index.js";
import ImageProcessor from '../../media-processing/processors/ImageProcessor.js';
import VideoProcessor from '../../media-processing/processors/VideoProcessor.js';
import postsRepository from '../../repositories/PostsRepository.js';
import reelRepository from '../../repositories/ReelRepository.js';
import storiesRepository from '../../repositories/StoriesRepository.js';
import qdrantService from '../../services/QdrantService.js';
import { createFirebaseStorage } from '../../storage/StorageService.js';
import { bucket } from '../../config/firebase.config.js';
import fs from 'fs';
import type { MediaRequest, MediaInput, VariantInput, VariantOutput, MediaDeleteRequest } from '@types';
import { fileURLToPath } from 'url';
import path from 'path';
import { sDebug, sError } from 'sk-logger';
const __filename = path.dirname(fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);
const uploadPath = path.join(__dirname, '../../uploads/');
const connection = redisConnection();
const storage = createFirebaseStorage({ bucket });
async function processJob(job: any) {
  if (job.name === 'delete-media-cash') {
    const filesToDelete = job.data as string[];
    for (const file of filesToDelete) {
      const filePath = path.join(uploadPath, file);
      try {
        await fs.unlinkSync(filePath);
      } catch (e) {
        sDebug(e);
      }
    }
    sDebug(`Media clean up job completed`);
  }
  if (job.name === 'delete-media') {
    const mediaPaths: string[] = [];
    const mediaFiles = job.data as MediaDeleteRequest;
    const media = await mediaRepository.getMediaPaths(mediaFiles.targetId, mediaFiles.targetType);
    const mediaIds = media.map((input) => input.id);
    media.forEach((m) => {
      if (m.originalPath) mediaPaths.push(m.originalPath);
      if (m.thumbnailPath) mediaPaths.push(m.thumbnailPath);
      if (m.variantPaths && Array.isArray(m.variantPaths)) {
        m.variantPaths.forEach((filePath: string) => {
          if (filePath) mediaPaths.push(filePath);
        });
      }
      if (m.metadata) {
        if (m.metadata.webpPath) mediaPaths.push(m.metadata.webpPath);
        if (m.metadata.avifPath) mediaPaths.push(m.metadata.avifPath);
      }
    });

    try {
      const targetType = mediaFiles.targetType;
      const targetId = mediaFiles.targetId;
      sDebug(`Deleting ${mediaPaths.length} files for ${targetType}:${targetId}`);
      for (const file of mediaPaths) {
        await storage.delete(file);
      }
      if (targetType == "POST") {
        await postsRepository.deletePost(mediaFiles.userId, targetId);
      }
      if (targetType == "REEL") {
        await reelRepository.deleteReel(mediaFiles.userId, targetId);
      }
      if (targetType == "STORY") {
        await storiesRepository.deleteStory(mediaFiles.userId, targetId);
      }

      // Delete embeddings from Qdrant
      for (const mId of mediaIds) {
        await qdrantService.deleteMediaEmbeddings(mId);
      }
    } catch (e) {
      sError(e);
    }
    let done = false;
    if (mediaIds.length > 0) {
      done = await mediaRepository.hardDelete(mediaIds);
    }

    sDebug(`Media clean up job completed :: ${done}`);
  }
}



const mediaCleanUpWorker = new Worker(
  'mediaCleanUpQueue',
  async (job) => {
    await processJob(job);
  },
  {
    connection, concurrency: 5,

  }
);


mediaCleanUpWorker.on('completed', (job) => {
  sDebug('Media clean up job completed', job.data.targetId);
});

mediaCleanUpWorker.on('failed', (job, err) => {
  sError('Media clean up job failed', err);
});

export default mediaCleanUpWorker;
