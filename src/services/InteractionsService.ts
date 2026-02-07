import intractionRepository from "../repositories/InteractionsRepository.js";
import redisService from "../cache/RedisService.js";
import likeQueue from "../jobs/queues/likeQueue.js";
import reelLikeQueue from "../jobs/queues/reelLikeQueue.js";
import commentLikeQueue from "../jobs/queues/commentLikeQueue.js";
import storyLikeQueue from "../jobs/queues/storyLikeQueue.js";
import notificationsService from "../services/NotificationsService.js";
import postsRepository from "../repositories/PostsRepository.js";
import { getIO } from "../utils/socketManager.js";
import { sDebug, sError, sInfo, sLog } from "sk-logger";

class IntractionsService {

  async likeComment(commentId: string, userId: string, reactionType: 'like' | string = 'like') {
    try {
      const shouldProcessNow = await redisService.incrementCommentLike(commentId, userId);

      // Immediate processing for viral comments
      if (shouldProcessNow) {
        sDebug(`Processing likes for comment ${commentId} immediately`);
        await commentLikeQueue.addBatchJob(commentId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: commentId, targetType: 'comment', userId, action: 'like' })
        .catch(e => sError('Queue broadcastLike failed:', e));

      return true;
    }
    catch (error) {
      sError(error);
      throw new Error("Error in liking comment")
    }
  }
  async unlikeComment(commentId: string, userId: string) {
    try {
      const shouldProcessNow = await redisService.removeCommentLike(commentId, userId);
      if (shouldProcessNow) {
        sDebug(`Processing unlikes for comment ${commentId} immediately`);
        await commentLikeQueue.addBatchJob(commentId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: commentId, targetType: 'comment', userId, action: 'unlike' })
        .catch(e => sError('Queue unlikeComment failed:', e));

      return true;
    }
    catch (error) {
      sError(error);
      throw new Error("Error in unliking comment")
    }
  }
  async likeReel(userId: string, reelId: string) {
    try {
      const shouldProcessNow = await redisService.incrementReelLike(reelId, userId);

      // Immediate processing for viral posts
      if (shouldProcessNow) {
        sDebug(`Processing likes for reel ${reelId} immediately`);
        await reelLikeQueue.addBatchJob(reelId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: reelId, targetType: 'reel', userId, action: 'like' })
        .catch(e => sError('Queue likeReel failed:', e));
    }
    catch (error) {
      sError(error);
      throw new Error("Error in liking reel")
    }
  }

  async unlikeReel(userId: string, reelId: string) {
    try {
      await redisService.removeReelLike(reelId, userId);

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: reelId, targetType: 'reel', userId, action: 'unlike' })
        .catch(e => sError('Queue unlikeReel failed:', e));

      return true;
    }
    catch (error) {
      sError(error);
      throw new Error("Error in unliking reel")
    }
  }


  async likePost(postId: string, userId: string) {
    try {

      const shouldProcessNow = await redisService.incrementLike(postId, userId);
      // Immediate processing for viral posts
      if (shouldProcessNow) {
        sInfo(`Processing likes for post ${postId} immediately`);
        await likeQueue.addBatchJob(postId, { priority: 1 });
      }
      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: postId, targetType: 'post', userId, action: 'like' })
        .catch(e => sError('Queue likePost failed:', e));

      // Trigger feed invalidation for the user to reflect new preferences (async, non-blocking)
      setImmediate(() => {
        import('./FeedPrecomputeService.js').then(m => m.default.invalidateUserFeed(userId))
          .catch(err => sError('Feed invalidation failed:', err));
      });
    }

    catch (error) {
      sError(error);
      throw new Error("Error in liking post")
    }
  }
  async unlikePost(postId: string, userId: string) {
    try {
      const shouldProcessNow = await redisService.removeLike(postId, userId);
      if (shouldProcessNow) {
        sDebug(`Processing unlikes for post ${postId} immediately`);
        await likeQueue.addBatchJob(postId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: postId, targetType: 'post', userId, action: 'unlike' })
        .catch(e => sError('Queue unlikePost failed:', e));

      return true;
    }
    catch (error) {
      sError(error);
      throw new Error("Error in unliking post")
    }
  }

  async likeStory(userId: string, storyId: string) {
    try {
      const shouldProcessNow = await redisService.incrementStoryLike(storyId, userId);

      // Immediate processing for viral stories
      if (shouldProcessNow) {
        sDebug(`Processing likes for story ${storyId} immediately`);
        await storyLikeQueue.addBatchJob(storyId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: storyId, targetType: 'story', userId, action: 'like' })
        .catch(e => sError('Queue likeStory failed:', e));
    } catch (error) {
      sError(error);
      throw new Error("Error in liking story");
    }
  }

  async unlikeStory(userId: string, storyId: string) {
    try {
      const shouldProcessNow = await redisService.removeStoryLike(storyId, userId);
      if (shouldProcessNow) {
        sDebug(`Processing unlikes for story ${storyId} immediately`);
        await storyLikeQueue.addBatchJob(storyId, { priority: 1 });
      }

      // Queue broadcast update (Non-blocking)
      this.queueBroadcastUpdate({ targetId: storyId, targetType: 'story', userId, action: 'unlike' })
        .catch(e => sError('Queue unlikeStory failed:', e));

      return true;
    } catch (error) {
      sError(error);
      throw new Error("Error in unliking story");
    }
  }

  async sharePost(postId: string, userId: string) {
    try {
      const result = await intractionRepository.sharePost(postId, userId);

      // Send notification
      const postOwner = await postsRepository.getPostOwner(postId);
      if (postOwner && postOwner.userId !== userId) {
        await notificationsService.notify({
          recipientId: postOwner.userId,
          actorId: userId,
          notificationType: 'share',
          targetType: 'post',
          targetId: postId,
          message: 'shared your post',
          sendPush: true
        });
      }

      return result;
    }
    catch (error) {
      sError(error);
      throw new Error("Error in sharing post")
    }
  }

  async recordPostInterest(postId: string, userId: string) {
    try {
      const cassandraFeedRepo = (await import('../repositories/CassandraFeedRepository.js')).default;
      const feedPrecomputeService = (await import('./FeedPrecomputeService.js')).default;

      await cassandraFeedRepo.recordUserInteraction(userId, postId, 'post', 'interested');

      // Trigger feed invalidation to boost similar content
      await feedPrecomputeService.invalidateUserFeed(userId);

      return true;
    } catch (error) {
      sError(error);
      throw new Error("Error recording post interest");
    }
  }

  async recordView(userId: string, targetId: string, type: string, durationMs: number) {
    try {
      const { pool } = await import("../config/pg.config.js");

      await pool.query(
        `INSERT INTO user_interactions (user_id, target_id, interaction_type, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [userId, targetId, type, durationMs]
      );

      // If viewing a profile or long post view, trigger feed recompute
      if (type === 'profile_visit' || (type === 'view' && durationMs > 5000)) {
        // Debounce or immediate implementation logic
        // For now, let's just log it. Real-time recompute might be too heavy for every view.
      }

      return true;
    } catch (error) {
      sError(`Error recording view for user ${userId}:`, error);
      // Don't throw, just log. Metric loss is acceptable.
      return false;
    }
  }

  async recordPostDisinterest(postId: string, userId: string) {
    try {
      const cassandraFeedRepo = (await import('../repositories/CassandraFeedRepository.js')).default;
      const feedPrecomputeService = (await import('./FeedPrecomputeService.js')).default;

      await cassandraFeedRepo.recordUserInteraction(userId, postId, 'post', 'not_interested');

      // Trigger feed invalidation to demote similar content
      await feedPrecomputeService.invalidateUserFeed(userId);

      return true;
    } catch (error) {
      sError(error);
      throw new Error("Error recording post disinterest");
    }
  }

  /**
   * Queue interaction update for debounced broadcast.
   */
  private async queueBroadcastUpdate({
    targetId,
    targetType,
    userId,
    action
  }: {
    targetId: string;
    targetType: 'post' | 'reel' | 'comment' | 'story';
    userId: string;
    action: 'like' | 'unlike';
  }) {
    try {
      // Get current count from Redis
      let count = 0;
      if (targetType === 'post') {
        count = await redisService.getLikeCount(targetId);
      } else if (targetType === 'reel') {
        count = await redisService.getReelLikeCount(targetId);
      } else if (targetType === 'comment') {
        count = await redisService.getCommentLikeCount(targetId);
      } else if (targetType === 'story') {
        count = await redisService.getStoryLikeCount(targetId);
      }

      // Queue for debounced broadcast
      await redisService.queueInteractionBroadcast(targetId, targetType, count);

      // We still emit the action immediately but without the count if needed, 
      // or we can rely entirely on the debounced aggregated updates.
      // For high UX responsiveness, we'll emit the action but the count might be slightly stale or omitted.
      const io = getIO();
      let room = '';
      if (targetType === 'post') room = `post_${targetId}`;
      else if (targetType === 'reel') room = `reel_${targetId}`;
      else if (targetType === 'story') room = `story_${targetId}`;
      else if (targetType === 'comment') {
        const comment = await redisService.getComment(targetId);
        if (comment?.postId) room = `post_${comment.postId}`;
        else {
          const reelComment = await redisService.getReelComment(targetId);
          if (reelComment?.reelId) room = `reel_${reelComment.reelId}`;
        }
      }

      if (room) {
        io.to(room).emit('likeUpdate', {
          [targetType === 'comment' ? 'commentId' : `${targetType}Id`]: targetId,
          userId,
          action,
        });
      }
    } catch (error) {
      sError(`[InteractionsService] queueBroadcastUpdate failed:`, error);
    }
  }

}
const intractionsService = new IntractionsService();
export default intractionsService;
