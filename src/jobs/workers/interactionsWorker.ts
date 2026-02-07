import { Worker } from 'bullmq';
import intractionsService from '../../services/InteractionsService.js';
import intractionRepository from "../../repositories/InteractionsRepository.js";
import redisService from "../../cache/RedisService.js";
import { redisConnection } from "../index.js";
import notificationsService from "../../services/NotificationsService.js";
import postsRepository from "../../repositories/PostsRepository.js";
import reelRepository from "../../repositories/ReelRepository.js";
import storiesRepository from "../../repositories/StoriesRepository.js";
import { sDebug, sError, sInfo, sLog } from 'sk-logger';
const connection = redisConnection();

export async function processInteractionsJob(job: any) {
  if (job.name === 'batch-process-all-likes') {
    // Get all posts with pending likes
    const postIds = await redisService.getAllPostsWithPendingLikes();

    for (let i = 0; i < postIds.length; i++) {
      const postId = postIds[i];
      if (!postId) continue;
      const likes = await redisService.getAccumulatedLikes(postId);

      if (likes.length > 0) {
        sDebug(`Processing ${likes.length} likes for post ${postId}`);
        try {
          await intractionRepository.bulkInsertPostLikes(likes);
        } catch (err: any) {
          sError(`Failed to insert likes for post ${postId}:`, err);
          await redisService.clearProcessedLikes(postId);
          continue;
        }
        await redisService.clearProcessedLikes(postId);

        // Send notification to post owner
        try {
          const postOwner = await postsRepository.getPostOwner(postId);
          if (postOwner) {
            const uniqueLikers = [...new Set(likes.map(like => like.userId).filter(userId => userId !== postOwner.userId))];
            const notificationPromises = uniqueLikers.map(actorId =>
              notificationsService.notify({
                recipientId: postOwner.userId,
                actorId,
                notificationType: 'like',
                targetType: 'post',
                targetId: postId,
                useAggregation: true
              })
            );
            if (notificationPromises.length > 0) await Promise.all(notificationPromises);
            sDebug(` Added ${uniqueLikers.length} likes to notification aggregation buffer for post ${postId}`);
          }
        } catch (notifError) {
          sError(`Failed to buffer notifications for post ${postId}:`, notifError);
        }
      }
      if (i % 10 === 0 || i === postIds.length - 1) {
        await job.updateProgress(Math.floor((i / postIds.length) * 100));
      }
    }
  }

  if (job.name === 'batch-process-all-reel-likes') {
    // Get all posts with pending likes
    const reelIds = await redisService.getAllReelsWithPendingLikes();

    for (let i = 0; i < reelIds.length; i++) {
      const reelId = reelIds[i];
      if (!reelId) continue;
      const likes = await redisService.getAccumulatedReelLikes(reelId);

      if (likes.length > 0) {
        sDebug(`Processing ${likes.length} likes for reel ${reelId}`);
        try {
          await intractionRepository.bulkInsertReelLikes(likes);
        } catch (err: any) {
          sError(`Failed to insert likes for reel ${reelId}:`, err);
          await redisService.clearProcessedReelLikes(reelId);
          continue;
        }
        await redisService.clearProcessedReelLikes(reelId);

        try {
          const reelOwner = await reelRepository.getReelOwner(reelId);
          if (reelOwner) {
            const uniqueLikers = [...new Set(likes.map(like => like.userId).filter(userId => userId !== reelOwner.userId))];
            const notificationPromises = uniqueLikers.map(actorId =>
              notificationsService.notify({
                recipientId: reelOwner.userId,
                actorId,
                notificationType: 'like',
                targetType: 'reel',
                targetId: reelId,
                useAggregation: true
              })
            );
            if (notificationPromises.length > 0) await Promise.all(notificationPromises);
            sDebug(` Added ${uniqueLikers.length} likes to notification aggregation buffer for reel ${reelId}`);
          }
        } catch (notifError) {
          sError(`Failed to buffer notifications for reel ${reelId}:`, notifError);
        }
      }
      if (i % 10 === 0 || i === reelIds.length - 1) {
        await job.updateProgress(Math.floor((i / reelIds.length) * 100));
      }
    }
  }

  if (job.name === 'batch-process-all-reel-unlikes') {
    const reelIds = await redisService.getAllReelsWithPendingUnlikes();

    for (const reelId of reelIds) {
      const userIds = await redisService.getAccumulatedReelUnlikes(reelId);

      if (userIds.length > 0) {
        sDebug(`Processing ${userIds.length} unlikes for reel ${reelId}`);
        await intractionRepository.bulkDeleteReelLikes(userIds, reelId);
        await redisService.clearProcessedReelUnlikes(reelId);
      }
    }
  }

  if (job.name === 'batch-process-all-comment-likes') {
    // Get all comments with pending likes
    const commentIds = await redisService.getAllCommentsWithPendingLikes();

    for (const commentId of commentIds) {
      const likes = await redisService.getAccumulatedCommentLikes(commentId);

      if (likes.length > 0) {
        sDebug(`Processing ${likes.length} likes for comment ${commentId}`);
        try {
          await intractionRepository.bulkInsertCommentLikes(likes);
        } catch (err: any) {
          sError(`Failed to insert likes for comment ${commentId}:`, err);
          await redisService.clearProcessedCommentLikes(commentId);
          continue;
        }
        await redisService.clearProcessedCommentLikes(commentId);

        // Send notification to comment owner logic could be added here similar to posts/reels
        // Assuming we want notifications for comment likes:
        /*
        try {
           const commentOwner = await pool.query('SELECT user_id FROM comments WHERE comment_id = $1', [commentId]);
           if (commentOwner.rows.length > 0) {
              // Notification logic
           }
        } catch (error) {}
        */
      }
    }
  }

  if (job.name === 'batch-process-all-comment-unlikes') {
    const commentIds = await redisService.getAllCommentsWithPendingUnlikes();

    for (const commentId of commentIds) {
      const userIds = await redisService.getAccumulatedCommentUnlikes(commentId);

      if (userIds.length > 0) {
        sDebug(`Processing ${userIds.length} unlikes for comment ${commentId}`);
        await intractionRepository.bulkDeleteCommentLikes(userIds, commentId);
        await redisService.clearProcessedCommentUnlikes(commentId);
      }
    }
  }

  if (job.name === 'batch-process-all-unlikes') {
    const postIds = await redisService.getAllPostsWithPendingUnlikes();

    for (const postId of postIds) {
      const userIds = await redisService.getAccumulatedPostUnlikes(postId);

      if (userIds.length > 0) {
        sDebug(`Processing ${userIds.length} unlikes for post ${postId}`);
        await intractionRepository.bulkDeletePostLikes(userIds, postId);
        await redisService.clearProcessedPostUnlikes(postId);
      }
    }
  }

  if (job.name === 'batch-process-all-story-likes') {
    // Get all stories with pending likes
    const storyIds = await redisService.getAllStoriesWithPendingLikes();

    for (let i = 0; i < storyIds.length; i++) {
      const storyId = storyIds[i];
      if (!storyId) continue;
      const likes = await redisService.getAccumulatedStoryLikes(storyId);

      if (likes.length > 0) {
        sDebug(`Processing ${likes.length} likes for story ${storyId}`);
        try {
          await intractionRepository.bulkInsertStoryLikes(likes);
        } catch (err: any) {
          sError(`Failed to insert likes for story ${storyId}:`, err);
          await redisService.clearProcessedStoryLikes(storyId);
          continue;
        }
        await redisService.clearProcessedStoryLikes(storyId);

        try {
          const storyOwner = await storiesRepository.getStoryOwner(storyId);
          if (storyOwner) {
            const uniqueLikers = [...new Set(likes.map(like => like.userId).filter(userId => userId !== storyOwner.userId))];
            const notificationPromises = uniqueLikers.map(actorId =>
              notificationsService.notify({
                recipientId: storyOwner.userId,
                actorId,
                notificationType: 'like',
                targetType: 'story',
                targetId: storyId,
                useAggregation: true
              })
            );
            if (notificationPromises.length > 0) await Promise.all(notificationPromises);
            sDebug(` Added ${uniqueLikers.length} likes to notification aggregation buffer for story ${storyId}`);
          }
        } catch (notifError) {
          sError(`Failed to buffer notifications for story ${storyId}:`, notifError);
        }
      }
      if (i % 10 === 0 || i === storyIds.length - 1) {
        await job.updateProgress(Math.floor((i / storyIds.length) * 100));
      }
    }
  }

  if (job.name === 'batch-process-all-story-unlikes') {
    const storyIds = await redisService.getAllStoriesWithPendingUnlikes();

    for (const storyId of storyIds) {
      const userIds = await redisService.getAccumulatedStoryUnlikes(storyId);

      if (userIds.length > 0) {
        sDebug(`Processing ${userIds.length} unlikes for story ${storyId}`);
        await intractionRepository.bulkDeleteStoryLikes(userIds, storyId);
        await redisService.clearProcessedStoryUnlikes(storyId);
      }
    }
  }
}
const worker = new Worker(
  'likeQueue',
  async (job) => {
    await processInteractionsJob(job);
  },

  {
    connection,
    lockDuration: 300000, // 5 minutes
    maxStalledCount: 1
  }
);
const reelLikeWorker = new Worker(
  'reelLikeQueue',
  async (job) => {
    sDebug('Processing reel likes job');
    await processInteractionsJob(job);
  },
  {
    connection,
    lockDuration: 300000,
    maxStalledCount: 1
  }
);

const commentLikeWorker = new Worker(
  'commentLikeQueue',
  async (job) => {
    sDebug('Processing comment likes job');
    await processInteractionsJob(job);
  },
  {
    connection,
    lockDuration: 300000,
    maxStalledCount: 1
  }
);

worker.on('completed', (job) => {
  const targetId = job.data?.postId || 'Batch Process';
  sDebug('Like processed for post', targetId);
})
worker.on('failed', (job, err) => {
  sError('Failed like job', err);
});

reelLikeWorker.on('completed', (job) => {
  const targetId = job.data?.reelId || 'Batch Process';
  sDebug('Reel like processed for reel', targetId);
})
reelLikeWorker.on('failed', (job, err) => {
  sError('Failed reel like job', err);
});

commentLikeWorker.on('completed', (job) => {
  sDebug('Comment like processed for comment', job.data.commentId);
})
commentLikeWorker.on('failed', (job, err) => {
  sError('Failed comment like job', err);
});

const storyLikeWorker = new Worker(
  'storyLikeQueue',
  async (job) => {
    sDebug('Processing story likes job');
    await processInteractionsJob(job);
  },
  {
    connection,
    lockDuration: 300000,
    maxStalledCount: 1
  }
);

storyLikeWorker.on('completed', (job) => {
  sLog('Story like processed for story', job.data.storyId);
})
storyLikeWorker.on('failed', (job, err) => {
  sError('Failed story like job', err);
});

export { worker, reelLikeWorker, storyLikeWorker, commentLikeWorker };