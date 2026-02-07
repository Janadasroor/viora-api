import type { CashedComment, Comment } from '@types';
import redisClient from '../config/redis.config.js';
import { v4 as uuidv4 } from 'uuid';
import { sDebug, sError, sLog, sInfo } from 'sk-logger';

export class RedisService {
  private isValidUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  constructor() {
    // Connection is handled in redis.config.ts
  }

  //#region Likes
  /**
   * Get all accumulated likes for a specific post
   * @param {string} postId - The post ID
   * @returns {Array} Array of like objects: [{ postId, userId, createdAt }, ...]
   */
  async getAccumulatedLikes(postId: string) {
    try {
      // Get all userIds from the Redis Set
      const userIds = await redisClient.sMembers(`likes:${postId}:pending`);

      if (!userIds || userIds.length === 0) {
        return [];
      }

      // Transform into proper format for bulk insert
      const likes = userIds.map(userId => ({
        postId: postId,
        userId: userId,
        reactionType: 'like',
        createdAt: new Date()
      }));

      return likes;

    } catch (error) {
      sError(`Error getting accumulated likes for post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Get all post IDs that have pending likes
   * @returns {Array} Array of post IDs
   */
  async getAllPostsWithPendingLikes() {
    try {
      // Scan for all keys matching pattern
      const keys = await this.scanKeys('likes:*:pending');;

      const postIds = keys.map(key => {
        const parts = key.split(':');
        return parts[1]; // Get the postId part
      });

      return postIds.filter(
        (id): id is string => {
          const sid = id as string;
          return Boolean(sid) && this.isValidUUID(sid);
        }
      );

    } catch (error) {
      sError('Error getting posts with pending likes:', error);
      throw error;
    }
  }

  /**
   * Increment like count and add user to pending set
   * @param {string} postId 
   * @param {string} userId 
   * @returns {number} Current count of pending likes
   */
  async testRedisConnection() {
    try {
      await redisClient.ping();
      await redisClient.set('test', 'test');
      sLog(' Redis connection test passed');
    } catch (error) {
      sError('Error testing Redis connection:', error);
      throw error;
    }
  }
  async incrementLike(postId: string, userId: string) {
    try {
      if (!this.isValidUUID(postId)) {
        sError(`Invalid postId for like: ${postId}. Skipping.`);
        return false;
      }
      // Convert number to string
      const userKey = userId;
      sLog(' Redis connection test passed');
      // Add user to pending likes set (prevents duplicates)
      await redisClient.sAdd(`likes:${postId}:pending`, userKey);
      sLog(' Redis connection test passed');
      // Increment total count
      await redisClient.incr(`likes:${postId}:count`);
      // Set expiry to ensure periodic processing picks it up
      await redisClient.expire(`likes:${postId}:pending`, 30); // 30 seconds TTL

      sLog(' Redis connection test passed');
      // Get current count of pending likes
      const count = await redisClient.sCard(`likes:${postId}:pending`);

      return count > 100;

    } catch (error) {
      sError(`Error incrementing like for post ${postId}:`, error);
      throw error;
    }
  }

  async removeLike(postId: string, userId: string) {
    try {
      const userKey = userId;
      const isPending = await redisClient.sIsMember(`likes:${postId}:pending`, userKey);

      if (isPending) {
        await redisClient.sRem(`likes:${postId}:pending`, userKey);
        await redisClient.decr(`likes:${postId}:count`);
        sDebug(`Removed pending like for post ${postId} user ${userId}`);
        return true;
      }

      await redisClient.sAdd(`unlikes:${postId}:pending`, userKey);
      await redisClient.decr(`likes:${postId}:count`);
      await redisClient.expire(`unlikes:${postId}:pending`, 30);
      return true;
    } catch (error) {
      sError(`Error removing like for post ${postId}:`, error);
      throw error;
    }
  }

  async getAccumulatedPostUnlikes(postId: string) {
    try {
      const userIds = await redisClient.sMembers(`unlikes:${postId}:pending`);
      if (!userIds?.length) return [];
      return userIds;
    } catch (error) {
      sError(`Error getting accumulated unlikes for post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Queue an interaction update for debounced broadcasting.
   */
  async queueInteractionBroadcast(targetId: string, targetType: string, count: number): Promise<void> {
    try {
      const key = `broadcast:pending_targets`;
      const countKey = `broadcast:latest_count:${targetId}:${targetType}`;

      // Add target to pending set
      await redisClient.sAdd(key, `${targetId}:${targetType}`);
      // Record latest count
      await redisClient.set(countKey, count.toString());
      // Set TTL for count (1 hour)
      await redisClient.expire(countKey, 3600);
    } catch (error) {
      sError('Error queuing interaction broadcast:', error);
    }
  }

  /**
   * Get all targets waiting for broadcast.
   */
  async getPendingBroadcasts(): Promise<string[]> {
    try {
      return await redisClient.sMembers(`broadcast:pending_targets`);
    } catch (error) {
      sError('Error getting pending broadcasts:', error);
      return [];
    }
  }

  /**
   * Get the latest count for a broadcast target.
   */
  async getLatestBroadcastCount(targetId: string, targetType: string): Promise<number> {
    try {
      const countKey = `broadcast:latest_count:${targetId}:${targetType}`;
      const val = await redisClient.get(countKey);
      return val ? parseInt(val, 10) : 0;
    } catch (error) {
      sError('Error getting latest broadcast count:', error);
      return 0;
    }
  }

  /**
   * Clear processed broadcast targets.
   */
  async clearPendingBroadcasts(targets: string[]): Promise<void> {
    try {
      if (targets.length > 0) {
        await redisClient.sRem(`broadcast:pending_targets`, targets);
        for (const target of targets) {
          const [targetId, targetType] = target.split(':');
          await redisClient.del(`broadcast:latest_count:${targetId}:${targetType}`);
        }
      }
    } catch (error) {
      sError('Error clearing pending broadcasts:', error);
    }
  }

  /**
   * Buffer story views to handle high traffic.
   */
  async addToViewBuffer(storyId: string, userId: string): Promise<number> {
    try {
      const key = `views:story:${storyId}:buffer`;
      await redisClient.sAdd(key, userId);
      await redisClient.expire(key, 3600); // 1 hour TTL
      return await redisClient.sCard(key);
    } catch (error) {
      sError('Error adding to view buffer:', error);
      throw error;
    }
  }

  /**
   * Get all accumulated views for a story.
   */
  async getAccumulatedViews(storyId: string): Promise<string[]> {
    try {
      return await redisClient.sMembers(`views:story:${storyId}:buffer`);
    } catch (error) {
      sError('Error getting accumulated views:', error);
      return [];
    }
  }

  /**
   * Clear view buffer after processing.
   */
  async clearViewBuffer(storyId: string): Promise<void> {
    try {
      await redisClient.del(`views:story:${storyId}:buffer`);
      await redisClient.sRem('views:pending_stories', storyId);
    } catch (error) {
      sError('Error clearing view buffer:', error);
    }
  }

  /**
   * Track which stories have pending views.
   */
  async trackPendingViews(storyId: string): Promise<void> {
    try {
      await redisClient.sAdd('views:pending_stories', storyId);
    } catch (error) {
      sError('Error tracking pending views:', error);
    }
  }

  /**
   * Get all stories with pending views.
   */
  async getAllStoriesWithPendingViews(): Promise<string[]> {
    try {
      return await redisClient.sMembers('views:pending_stories');
    } catch (error) {
      sError('Error getting stories with pending views:', error);
      return [];
    }
  }

  async getAllPostsWithPendingUnlikes() {
    try {
      const keys = await this.scanKeys('unlikes:*:pending');
      return keys.map(key => key.split(':')[1]).filter((id): id is string => Boolean(id));
    } catch (error) {
      sError('Error getting posts with pending unlikes:', error);
      throw error;
    }
  }

  async clearProcessedPostUnlikes(postId: string) {
    try {
      await redisClient.del(`unlikes:${postId}:pending`);
      sDebug(` Cleared pending unlikes for post ${postId}`);
    } catch (error) {
      sError(`Error clearing processed unlikes for post ${postId}:`, error);
      throw error;
    }
  }


  /**
   * Clear processed likes after successful DB insert
   * @param {string} postId 
   */
  async clearProcessedLikes(postId: string) {
    try {
      // Delete the pending likes set
      await redisClient.del(`likes:${postId}:pending`);

      sDebug(` Cleared ${postId} pending likes from Redis`);

    } catch (error) {
      sError(`Error clearing processed likes for post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Get current like count for a post (for display purposes)
   * @param {string} postId 
   * @returns {number} Like count
   */
  async getLikeCount(postId: string) {
    try {
      const count = await redisClient.get(`likes:${postId}:count`);
      return parseInt(count || '0');

    } catch (error) {
      sError(`Error getting like count for post ${postId}:`, error);
      return 0;
    }
  }

  /**
   * Set like count (for cache warming from DB)
   * @param {string} postId 
   * @param {number} count 
   */
  async setLikeCount(postId: string, count: number) {
    try {
      await redisClient.set(`likes:${postId}:count`, count);
      await redisClient.expire(`likes:${postId}:count`, 3600); // 1 hour TTL

    } catch (error) {
      sError(`Error setting like count for post ${postId}:`, error);
      throw error;
    }
  }
  /**
   * Scan all Redis keys matching a given pattern
   * @param {string} pattern - The pattern to match (e.g. "likes:*")
   * @returns {Array<string>} An array of matching key names
   */
  //This is faster than redisClient.keys
  async scanKeys(pattern: string) {
    let cursor = '0', keys = [];
    do {
      const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 1000 });
      cursor = reply.cursor;
      keys.push(...reply.keys);
    } while (cursor !== '0');
    return keys;
  }
  //#endregion


  //#region Reel views
  async incrementReelView(reelId: string, userId: string, watchTime?: number, duration?: number) {
    try {
      const userKey = userId;


      // 2. Detailed view logging (Queue-based for Cassandra)
      const viewData = JSON.stringify({
        reelId,
        userId: userId || '0', // Handle optional userId
        watchTime: watchTime || 0,
        duration: duration || 0,
        viewedAt: new Date().toISOString()
      });
      await redisClient.lPush('reel_views_detailed:pending', viewData);
      sLog(`[RedisService] Pushed view log to 'reel_views_detailed:pending': ${viewData}`);
      // Trim if it gets too long
      await redisClient.lTrim('reel_views_detailed:pending', 0, 10000);

      // Check list length to trigger worker
      const count = await redisClient.lLen('reel_views_detailed:pending');
      return count >= 10;
    } catch (error) {
      sError(`Error incrementing view for reel ${reelId}:`, error);
      throw error;
    }
  }

  /**
   * Pop detailed views from the pending list
   */
  async popPendingDetailedViews(limit: number = 100): Promise<any[]> {
    try {
      const views: any[] = [];
      for (let i = 0; i < limit; i++) {
        const data = await redisClient.rPop('reel_views_detailed:pending');
        if (!data) break;
        try {
          views.push(JSON.parse(data));
        } catch (e) {
          sError('Error parsing detailed reel view data from Redis:', e);
        }
      }
      if (views.length > 0) {
        sLog(`[RedisService] Popped ${views.length} views from 'reel_views_detailed:pending'`);
      }
      return views;
    } catch (error) {
      sError('Error popping detailed reel views from Redis:', error);
      return [];
    }
  }

  async clearProcessedReelViews() {
    try {
      // In the new system, detailed views are popped individually (RPOP), 
      // so we don't need to clear a whole list unless we're flushing.
      await redisClient.del('reel_views_detailed:pending');
      sDebug(` Cleared all pending detailed reel views from Redis`);
    } catch (error) {
      sError(`Error clearing processed reel views:`, error);
      throw error;
    }
  }
  // #endregion

  //#region Reel likes

  async incrementReelLike(reelId: string, userId: string) {
    try {
      if (!reelId || !this.isValidUUID(reelId)) {
        sError(`Invalid reelId for like: ${reelId}. Skipping.`);
        return { shouldProcessNow: false };
      }
      sDebug(`Incrementing like for reel ${reelId}`);
      const userKey = userId;
      await redisClient.sAdd(`reel_likes:${reelId}:pending`, userKey);

      // Increment like count
      await redisClient.incr(`reel_likes:${reelId}:count`);

      // Set TTL for pending key (ensures cleanup)
      await redisClient.expire(`reel_likes:${reelId}:pending`, 30);

      // Get current pending count
      const count = await redisClient.sCard(`reel_likes:${reelId}:pending`);

      // Return true only if threshold met (e.g. > 1000)
      return count >= 1;
    } catch (error) {
      sError(`Error incrementing like for reel ${reelId}:`, error);
      throw error;
    }
  }

  async removeReelLike(reelId: string, userId: string) {
    try {
      const userKey = userId;

      // Check if user is in pending likes set
      const isPending = await redisClient.sIsMember(`reel_likes:${reelId}:pending`, userKey);

      if (isPending) {
        // If pending, just remove it - no DB action needed
        await redisClient.sRem(`reel_likes:${reelId}:pending`, userKey);
        await redisClient.decr(`reel_likes:${reelId}:count`);
        sDebug(`Removed pending like for reel ${reelId} user ${userId}`);
        return true;
      }

      // If not pending, it's already in DB, so add to unlikes set
      await redisClient.sAdd(`reel_unlikes:${reelId}:pending`, userKey);
      // Decrement like count cache
      await redisClient.decr(`reel_likes:${reelId}:count`);

      // Set TTL
      await redisClient.expire(`reel_unlikes:${reelId}:pending`, 30);

      return true;
    } catch (error) {
      sError(`Error removing like for reel ${reelId}:`, error);
      throw error;
    }
  }


  async getAccumulatedReelLikes(reelId: string) {
    try {
      const userIds = await redisClient.sMembers(`reel_likes:${reelId}:pending`);
      if (!userIds?.length) return [];

      return userIds.map(userId => ({
        reelId: reelId,
        userId,
        reactionType: 'like',
        createdAt: new Date().toDateString()
      }));
    } catch (error) {
      sError(`Error getting accumulated reel likes for reel ${reelId}:`, error);
      throw error;
    }
  }

  async getAccumulatedReelUnlikes(reelId: string) {
    try {
      const userIds = await redisClient.sMembers(`reel_unlikes:${reelId}:pending`);
      if (!userIds?.length) return [];
      return userIds;
    } catch (error) {
      sError(`Error getting accumulated reel unlikes for reel ${reelId}:`, error);
      throw error;
    }
  }

  async getAllReelsWithPendingLikes() {
    try {
      const keys = await this.scanKeys('reel_likes:*:pending');
      return keys.map(key => key.split(':')[1]).filter(
        (id): id is string => Boolean(id)
      ); // extract reelId
    } catch (error) {
      sError('Error getting reels with pending likes:', error);
      throw error;
    }
  }

  async getAllReelsWithPendingUnlikes() {
    try {
      const keys = await this.scanKeys('reel_unlikes:*:pending');
      return keys.map(key => key.split(':')[1]).filter(
        (id): id is string => Boolean(id)
      );
    } catch (error) {
      sError('Error getting reels with pending unlikes:', error);
      throw error;
    }
  }

  async clearProcessedReelLikes(reelId: string) {
    try {
      await redisClient.del(`reel_likes:${reelId}:pending`);
      sDebug(` Cleared pending likes for reel ${reelId}`);
    } catch (error) {
      sError(`Error clearing processed likes for reel ${reelId}:`, error);
      throw error;
    }
  }

  async clearProcessedReelUnlikes(reelId: string) {
    try {
      await redisClient.del(`reel_unlikes:${reelId}:pending`);
      sDebug(` Cleared pending unlikes for reel ${reelId}`);
    } catch (error) {
      sError(`Error clearing processed unlikes for reel ${reelId}:`, error);
      throw error;
    }
  }
  // #endregion

  //#region Story likes
  async incrementStoryLike(storyId: string, userId: string) {
    try {
      if (!this.isValidUUID(storyId)) {
        sError(`Invalid storyId for like: ${storyId}. Skipping.`);
        return false;
      }
      // Add user to pending like set (no duplicates)
      const userKey = userId;
      await redisClient.sAdd(`story_likes:${storyId}:pending`, userKey);

      // Increment like count
      await redisClient.incr(`story_likes:${storyId}:count`);

      // Set TTL for pending key (ensures cleanup)
      await redisClient.expire(`story_likes:${storyId}:pending`, 30);

      // Get current pending count
      const count = await redisClient.sCard(`story_likes:${storyId}:pending`);

      // Return true only if threshold met
      return count >= 1;
    } catch (error) {
      sError(`Error incrementing like for story ${storyId}:`, error);
      throw error;
    }
  }

  async getStoryLikeCount(storyId: string) {
    try {
      const count = await redisClient.get(`story_likes:${storyId}:count`);
      return parseInt(count || '0');
    } catch (error) {
      sError(`Error getting like count for story ${storyId}:`, error);
      return 0;
    }
  }

  async removeStoryLike(storyId: string, userId: string) {
    try {
      const userKey = userId;
      const isPending = await redisClient.sIsMember(`story_likes:${storyId}:pending`, userKey);

      if (isPending) {
        await redisClient.sRem(`story_likes:${storyId}:pending`, userKey);
        await redisClient.decr(`story_likes:${storyId}:count`);
        sDebug(`Removed pending like for story ${storyId} user ${userId}`);
        return true;
      }

      await redisClient.sAdd(`story_unlikes:${storyId}:pending`, userKey);
      await redisClient.decr(`story_likes:${storyId}:count`);
      await redisClient.expire(`story_unlikes:${storyId}:pending`, 30);
      return true;
    } catch (error) {
      sError(`Error removing like for story ${storyId}:`, error);
      throw error;
    }
  }

  async getAccumulatedStoryUnlikes(storyId: string) {
    try {
      const userIds = await redisClient.sMembers(`story_unlikes:${storyId}:pending`);
      if (!userIds?.length) return [];
      return userIds;
    } catch (error) {
      sError(`Error getting accumulated unlikes for story ${storyId}:`, error);
      throw error;
    }
  }

  async getAllStoriesWithPendingUnlikes() {
    try {
      const keys = await this.scanKeys('story_unlikes:*:pending');
      return keys.map(key => key.split(':')[1]).filter((id): id is string => Boolean(id));
    } catch (error) {
      sError('Error getting stories with pending unlikes:', error);
      throw error;
    }
  }

  async clearProcessedStoryUnlikes(storyId: string) {
    try {
      await redisClient.del(`story_unlikes:${storyId}:pending`);
      sDebug(` Cleared pending unlikes for story ${storyId}`);
    } catch (error) {
      sError(`Error clearing processed unlikes for story ${storyId}:`, error);
      throw error;
    }
  }

  async getAccumulatedStoryLikes(storyId: string) {
    try {
      const userIds = await redisClient.sMembers(`story_likes:${storyId}:pending`);
      if (!userIds?.length) return [];

      return userIds.map(userId => ({
        storyId: storyId,
        userId,
        reactionType: 'like',
        createdAt: new Date().toDateString()
      }));
    } catch (error) {
      sError(`Error getting accumulated story likes for story ${storyId}:`, error);
      throw error;
    }
  }

  async getAllStoriesWithPendingLikes() {
    try {
      const keys = await this.scanKeys('story_likes:*:pending');
      return keys.map(key => key.split(':')[1]).filter(
        (id): id is string => Boolean(id)
      ); // extract storyId
    } catch (error) {
      sError('Error getting stories with pending likes:', error);
      throw error;
    }
  }

  async clearProcessedStoryLikes(storyId: string) {
    try {
      await redisClient.del(`story_likes:${storyId}:pending`);
      sDebug(` Cleared pending likes for story ${storyId}`);
    } catch (error) {
      sError(`Error clearing processed likes for story ${storyId}:`, error);
      throw error;
    }
  }
  // #endregion


  // #region Comments
  async incrementComment(postId: string, userId: string, content: string, updatedAt: Date, parentCommentId?: string | null) {
    try {
      if (!postId) throw new Error("postId is required");
      sDebug(`Incrementing comment for post ${postId}`);
      const commentId = uuidv4();
      const timestamp = updatedAt || new Date().toISOString();

      // Store comment details in a hash including updatedAt
      await redisClient.hSet(`comment:${commentId}`, {
        userId,
        postId,
        content,
        updatedAt: timestamp.toString(),
        parentCommentId: parentCommentId || "",
      });

      // Add comment ID to pending set for this post
      await redisClient.sAdd(`comments:${postId}:pending`, commentId);

      // Set TTL for periodic processing
      await redisClient.expire(`comments:${postId}:pending`, 30);

      // Return count of pending comments
      const count = await redisClient.sCard(`comments:${postId}:pending`);
      return { shouldProcessNow: count >= 1, commentId };
    } catch (error) {
      sError(`Error incrementing comment for post ${postId}:`, error);
      throw error;
    }
  }

  /**
   * Get a single comment by ID including updatedAt
   * @param {string} commentId
   * @returns {object|null}
   */
  async getComment(commentId: string) {
    try {
      const data = await redisClient.hGetAll(`comment:${commentId}`);
      if (!data || Object.keys(data).length === 0) return null;
      if (!data.userId) return null;
      const userId = data.userId;
      return {
        commentId,
        parentCommentId: data.parentCommentId,
        userId, //+"42" → 42
        content: data.content,
        postId: data.postId,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        createdAt: new Date(), // fallback
      };
    } catch (error) {
      sError(`Error getting comment ${commentId}:`, error);
      throw error;
    }
  }

  /**
   * Get all accumulated comments for a post
   * @param {string} postId
   * @returns {Array} Array of comment objects including updatedAt
   */
  async getAccumulatedComments(postId: string) {
    try {
      const commentIds = await redisClient.sMembers(`comments:${postId}:pending`);
      if (!commentIds || commentIds.length === 0) return [];
      const rawComments = await Promise.all(
        commentIds.map(async (commentId) => {
          const data = await this.getComment(commentId);
          if (!data) return null;
          sDebug(data);
          return {
            commentId,
            parentCommentId: data?.parentCommentId,
            postId: data?.postId || postId,
            userId: data?.userId,
            content: data?.content || "",
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          }

        })
      );

      const comments = rawComments.filter(
        (comment): comment is NonNullable<typeof comment> => Boolean(comment)
      );
      return comments;
    } catch (error) {
      sError(`Error getting accumulated comments for post ${postId}:`, error);
      throw error;
    }
  }
  /**
   * Get all post IDs that have pending comments
   * @returns {Array} Array of post IDs
   */
  async getAllPostsWithPendingComments(): Promise<string[]> {
    try {
      const postIds: string[] = [];
      let cursor: string = '0';

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'comments:*:pending',
          COUNT: 100,
        });

        cursor = result.cursor; // still a string
        const keys = result.keys;

        postIds.push(
          ...keys
            .map(key => key.split(':')[1]) // extract postId
            .filter((id): id is string => Boolean(id))
        );
      } while (cursor !== '0');

      // Remove duplicates in case a post has multiple pending comment keys
      return Array.from(new Set(postIds));
    } catch (error) {
      sError("Error getting posts with pending comments:", error);
      throw error;
    }
  }

  async getCommentIdsForDeletion(): Promise<string[]> {
    try {
      const commentIds: string[] = [];
      let cursor: string = "0";

      do {
        // Use object syntax in node-redis v4+
        const result = await redisClient.scan(cursor, {
          MATCH: 'comment:*',
          COUNT: 100,
        });

        cursor = result.cursor;
        const keys = result.keys;

        commentIds.push(
          ...keys
            .map(key => key.split(':')[1])
            .filter((id): id is string => Boolean(id))
        );
      } while (cursor !== '0');

      return commentIds;
    } catch (error) {
      sError("Error getting pending comment IDs:", error);
      throw error;
    }
  }




  /**
   * Clear processed comments after DB insert
   * @param {string} postId
   */
  async clearProcessedComments(postId: string) {
    try {
      await redisClient.del(`comments:${postId}:pending`);
      sDebug(` Cleared ${postId} pending comments from Redis`);
    } catch (error) {
      sError(`Error clearing processed comments for post ${postId}:`, error);
      throw error;
    }
  }

  async removeCommentFromPending(postId: string, commentId: string) {
    try {
      await redisClient.sRem(`comments:${postId}:pending`, commentId);
      await redisClient.del(`comment:${commentId}`);
      sDebug(` Removed single comment ${commentId} for post ${postId} from Redis`);
    } catch (error) {
      sError(`Error removing single comment ${commentId} from Redis:`, error);
    }
  }

  /**
   * Get comment count (for display purposes)
   * @param {string} postId
   * @returns {number} Comment count
   */
  async getCommentCount(postId: string) {
    try {
      const count = await redisClient.get(`comments:${postId}:count`);
      return parseInt(count || '0');
    } catch (error) {
      sError(`Error getting comment count for post ${postId}:`, error);
      return 0;
    }
  }

  /**
   * Set comment count (cache warming from DB)
   * @param {string} postId
   * @param {number} count
   */
  async setCommentCount(postId: string, count: number) {
    try {
      await redisClient.set(`comments:${postId}:count`, count);
      await redisClient.expire(`comments:${postId}:count`, 3600); // 1 hour TTL
    } catch (error) {
      sError(`Error setting comment count for post ${postId}:`, error);
      throw error;
    }
  }

  // #endregion

  // #region Comment Likes
  async incrementCommentLike(commentId: string, userId: string) {
    try {
      if (!this.isValidUUID(commentId)) {
        sError(`Invalid commentId for like: ${commentId}. Skipping.`);
        return false;
      }
      const userKey = userId;
      await redisClient.sAdd(`comment_likes:${commentId}:pending`, userKey);
      await redisClient.incr(`comment_likes:${commentId}:count`);
      await redisClient.expire(`comment_likes:${commentId}:pending`, 30);
      const count = await redisClient.sCard(`comment_likes:${commentId}:pending`);
      return count >= 1;
    } catch (error) {
      sError(`Error incrementing like for comment ${commentId}:`, error);
      throw error;
    }
  }

  async removeCommentLike(commentId: string, userId: string) {
    try {
      const userKey = userId;
      const isPending = await redisClient.sIsMember(`comment_likes:${commentId}:pending`, userKey);

      if (isPending) {
        await redisClient.sRem(`comment_likes:${commentId}:pending`, userKey);
        await redisClient.decr(`comment_likes:${commentId}:count`);
        sDebug(`Removed pending like for comment ${commentId} user ${userId}`);
        return true;
      }

      await redisClient.sAdd(`comment_unlikes:${commentId}:pending`, userKey);
      await redisClient.decr(`comment_likes:${commentId}:count`);
      await redisClient.expire(`comment_unlikes:${commentId}:pending`, 30);
      return true;
    } catch (error) {
      sError(`Error removing like for comment ${commentId}:`, error);
      throw error;
    }
  }

  async getAccumulatedCommentLikes(commentId: string) {
    try {
      const userIds = await redisClient.sMembers(`comment_likes:${commentId}:pending`);
      if (!userIds?.length) return [];
      return userIds.map(userId => ({
        commentId,
        userId,
        reactionType: 'like',
        createdAt: new Date().toDateString()
      }));
    } catch (error) {
      sError(`Error getting accumulated comment likes for comment ${commentId}:`, error);
      throw error;
    }
  }

  async getAccumulatedCommentUnlikes(commentId: string) {
    try {
      const userIds = await redisClient.sMembers(`comment_unlikes:${commentId}:pending`);
      if (!userIds?.length) return [];
      return userIds;
    } catch (error) {
      sError(`Error getting accumulated comment unlikes for comment ${commentId}:`, error);
      throw error;
    }
  }

  async getAllCommentsWithPendingLikes() {
    try {
      const keys = await this.scanKeys('comment_likes:*:pending');
      return keys.map(key => key.split(':')[1]).filter((id): id is string => {
        const sid = id as string;
        return Boolean(sid) && this.isValidUUID(sid);
      });
    } catch (error) {
      sError('Error getting comments with pending likes:', error);
      throw error;
    }
  }

  async getAllCommentsWithPendingUnlikes() {
    try {
      const keys = await this.scanKeys('comment_unlikes:*:pending');
      return keys.map(key => key.split(':')[1]).filter((id): id is string => Boolean(id));
    } catch (error) {
      sError('Error getting comments with pending unlikes:', error);
      throw error;
    }
  }

  async clearProcessedCommentLikes(commentId: string) {
    try {
      await redisClient.del(`comment_likes:${commentId}:pending`);
      sDebug(` Cleared pending likes for comment ${commentId}`);
    } catch (error) {
      sError(`Error clearing processed likes for comment ${commentId}:`, error);
      throw error;
    }
  }

  async clearProcessedCommentUnlikes(commentId: string) {
    try {
      await redisClient.del(`comment_unlikes:${commentId}:pending`);
      sDebug(` Cleared pending unlikes for comment ${commentId}`);
    } catch (error) {
      sError(`Error clearing processed unlikes for comment ${commentId}:`, error);
      throw error;
    }
  }

  async getCommentLikeCount(commentId: string) {
    try {
      const count = await redisClient.get(`comment_likes:${commentId}:count`);
      return parseInt(count || '0');
    } catch (error) {
      sError(`Error getting like count for comment ${commentId}:`, error);
      return 0;
    }
  }

  async getReelLikeCount(reelId: string) {
    try {
      const count = await redisClient.get(`reel_likes:${reelId}:count`);
      return parseInt(count || '0');
    } catch (error) {
      sError(`Error getting like count for reel ${reelId}:`, error);
      return 0;
    }
  }
  // #endregion

  // #region Reel Comments
  async incrementReelComment(reelId: string, userId: string, content: string, updatedAt: Date, parentCommentId?: string | null) {
    try {
      if (!reelId) throw new Error("reelId is required");
      sDebug(`Incrementing comment for reel ${reelId}`);
      const commentId = uuidv4();
      const timestamp = updatedAt || new Date().toISOString();

      // Store comment details in a hash including updatedAt
      await redisClient.hSet(`reel_comment:${commentId}`, {
        userId,
        reelId,
        content: content || "",
        updatedAt: timestamp.toString(),
        parentCommentId: parentCommentId || "",
      });

      // Add comment ID to pending set for this reel
      await redisClient.sAdd(`reel_comments:${reelId}:pending`, commentId);

      // Set TTL for periodic processing
      await redisClient.expire(`reel_comments:${reelId}:pending`, 30);

      // Return count of pending comments
      const count = await redisClient.sCard(`reel_comments:${reelId}:pending`);
      return { shouldProcessNow: count >= 1, commentId };
    } catch (error) {
      sError(`Error incrementing comment for reel ${reelId}:`, error);
      throw error;
    }
  }

  /**
   * Get a single reel comment by ID including updatedAt
   * @param {string} commentId
   * @returns {object|null}
   */
  async getReelComment(commentId: string) {
    try {
      const data = await redisClient.hGetAll(`reel_comment:${commentId}`);
      if (!data || Object.keys(data).length === 0) return null;
      if (!data.userId) return null;
      const userId = data.userId;
      return {
        commentId,
        parentCommentId: data.parentCommentId,
        userId,
        content: data.content,
        reelId: data.reelId,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        createdAt: new Date(), // fallback
      };
    } catch (error) {
      sError(`Error getting reel comment ${commentId}:`, error);
      throw error;
    }
  }

  /**
   * Get all accumulated comments for a reel
   * @param {string} reelId
   * @returns {Array} Array of comment objects including updatedAt
   */
  async getAccumulatedReelComments(reelId: string) {
    try {
      const commentIds = await redisClient.sMembers(`reel_comments:${reelId}:pending`);
      if (!commentIds || commentIds.length === 0) return [];
      const rawComments = await Promise.all(
        commentIds.map(async (commentId) => {
          const data = await this.getReelComment(commentId);
          if (!data) return null;
          return {
            commentId,
            parentCommentId: data?.parentCommentId,
            reelId: data?.reelId || reelId,
            userId: data?.userId,
            content: data?.content || "",
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          };
        })
      );

      const comments = rawComments.filter(
        (comment): comment is NonNullable<typeof comment> => Boolean(comment)
      );
      return comments;
    } catch (error) {
      sError(`Error getting accumulated comments for reel ${reelId}:`, error);
      throw error;
    }
  }

  /**
   * Get all reel IDs that have pending comments
   * @returns {Array} Array of reel IDs
   */
  async getAllReelsWithPendingComments(): Promise<string[]> {
    try {
      const reelIds: string[] = [];
      let cursor: string = '0';

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'reel_comments:*:pending',
          COUNT: 100,
        });

        cursor = result.cursor;
        const keys = result.keys;

        reelIds.push(
          ...keys
            .map(key => key.split(':')[1]) // extract reelId
            .filter((id): id is string => {
              const sid = id as string;
              return Boolean(sid) && this.isValidUUID(sid);
            })
        );
      } while (cursor !== '0');

      return Array.from(new Set(reelIds));
    } catch (error) {
      sError("Error getting reels with pending comments:", error);
      throw error;
    }
  }

  /**
   * Clear processed reel comments after DB insert
   * @param {string} reelId
   */
  async clearProcessedReelComments(reelId: string) {
    try {
      await redisClient.del(`reel_comments:${reelId}:pending`);
      sDebug(` Cleared ${reelId} pending reel comments from Redis`);
    } catch (error) {
      sError(`Error clearing processed comments for reel ${reelId}:`, error);
      throw error;
    }
  }

  async removeReelCommentFromPending(reelId: string, commentId: string) {
    try {
      await redisClient.sRem(`reel_comments:${reelId}:pending`, commentId);
      await redisClient.del(`reel_comment:${commentId}`);
      sDebug(` Removed single reel comment ${commentId} for reel ${reelId} from Redis`);
    } catch (error) {
      sError(`Error removing single reel comment ${commentId} from Redis:`, error);
    }
  }
  // #endregion

  // #region Story Comments
  async incrementStoryComment(storyId: string, userId: string, content: string, updatedAt: Date, parentCommentId?: string | null) {
    try {
      if (!storyId) throw new Error("storyId is required");
      sDebug(`Incrementing comment for story ${storyId}`);
      const commentId = uuidv4();
      const timestamp = updatedAt || new Date().toISOString();

      await redisClient.hSet(`story_comment:${commentId}`, {
        userId,
        storyId,
        content: content || "",
        updatedAt: timestamp.toString(),
        parentCommentId: parentCommentId || "",
      });

      await redisClient.sAdd(`story_comments:${storyId}:pending`, commentId);
      await redisClient.expire(`story_comments:${storyId}:pending`, 30);

      const count = await redisClient.sCard(`story_comments:${storyId}:pending`);
      return { shouldProcessNow: count >= 1, commentId };
    } catch (error) {
      sError(`Error incrementing comment for story ${storyId}:`, error);
      throw error;
    }
  }

  async getStoryComment(commentId: string) {
    try {
      const data = await redisClient.hGetAll(`story_comment:${commentId}`);
      if (!data || Object.keys(data).length === 0) return null;
      if (!data.userId) return null;
      return {
        commentId,
        parentCommentId: data.parentCommentId,
        userId: data.userId,
        content: data.content,
        storyId: data.storyId,
        updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
        createdAt: new Date(),
      };
    } catch (error) {
      sError(`Error getting story comment ${commentId}:`, error);
      throw error;
    }
  }

  async getAccumulatedStoryComments(storyId: string) {
    try {
      const commentIds = await redisClient.sMembers(`story_comments:${storyId}:pending`);
      if (!commentIds || commentIds.length === 0) return [];
      const rawComments = await Promise.all(
        commentIds.map(async (commentId) => {
          const data = await this.getStoryComment(commentId);
          if (!data) return null;
          return {
            commentId,
            parentCommentId: data?.parentCommentId,
            storyId: data?.storyId || storyId,
            userId: data?.userId,
            content: data?.content || "",
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          };
        })
      );

      return rawComments.filter((c): c is NonNullable<typeof c> => Boolean(c));
    } catch (error) {
      sError(`Error getting accumulated comments for story ${storyId}:`, error);
      throw error;
    }
  }

  async getAllStoriesWithPendingComments(): Promise<string[]> {
    try {
      const storyIds: string[] = [];
      let cursor: string = '0';

      do {
        const result = await redisClient.scan(cursor, {
          MATCH: 'story_comments:*:pending',
          COUNT: 100,
        });

        cursor = result.cursor;
        const keys = result.keys;

        storyIds.push(
          ...keys
            .map(key => key.split(':')[1])
            .filter((id): id is string => Boolean(id) && this.isValidUUID(id as string))
        );
      } while (cursor !== '0');

      return Array.from(new Set(storyIds));
    } catch (error) {
      sError("Error getting stories with pending comments:", error);
      throw error;
    }
  }

  async clearProcessedStoryComments(storyId: string) {
    try {
      await redisClient.del(`story_comments:${storyId}:pending`);
      sDebug(` Cleared ${storyId} pending story comments from Redis`);
    } catch (error) {
      sError(`Error clearing processed comments for story ${storyId}:`, error);
      throw error;
    }
  }

  async removeStoryCommentFromPending(storyId: string, commentId: string) {
    try {
      await redisClient.sRem(`story_comments:${storyId}:pending`, commentId);
      await redisClient.del(`story_comment:${commentId}`);
      sDebug(` Removed single story comment ${commentId} for story ${storyId} from Redis`);
    } catch (error) {
      sError(`Error removing single story comment ${commentId} from Redis:`, error);
    }
  }
  // #endregion

  //#region Notification Aggregation
  /**
   * Add interaction to notification aggregation buffer
   * Key pattern: notif_agg:{recipientId}:{targetType}:{targetId}:{notifType}
   */
  async addToNotificationAggregation(
    recipientId: string,
    actorId: string,
    targetType: string,
    targetId: string,
    notificationType: 'like' | 'comment' | 'new_post' | 'new_reel' | 'new_story'
  ): Promise<void> {
    try {
      const key = `notif_agg:${recipientId}:${targetType}:${targetId}:${notificationType}`;

      // Use sorted set with timestamp as score for chronological ordering
      await redisClient.zAdd(key, {
        score: Date.now(),
        value: actorId
      });

      // Set TTL to auto-cleanup (1 hour)
      await redisClient.expire(key, 3600);

      // Track which recipients have pending aggregations
      await redisClient.sAdd('notif_agg:pending_recipients', recipientId);

      sDebug(` Added actor ${actorId} to notification aggregation for ${targetType} ${targetId}`);
    } catch (error) {
      sError('Error adding to notification aggregation:', error);
      throw error;
    }
  }

  /**
   * Get all pending notification aggregations
   */
  async getPendingNotificationAggregations(): Promise<any[]> {
    try {
      const recipientIds = await redisClient.sMembers('notif_agg:pending_recipients');
      const batches: any[] = [];

      sDebug(`Found ${recipientIds.length} pending notification aggregations`);

      for (const recipientId of recipientIds) {
        // Scan for all aggregation keys for this recipient
        const keys = await this.scanKeys(`notif_agg:${recipientId}:*`);

        for (const key of keys) {
          const parts = key.split(':');
          if (parts.length < 5) continue;

          const [, , targetType, targetId, notificationType] = parts;

          // Get all actors with timestamps
          const actors = await redisClient.zRangeWithScores(key, 0, -1);

          if (actors.length > 0) {
            batches.push({
              recipientId: recipientId,
              targetType,
              targetId,
              notificationType,
              actors: actors.map(a => ({
                actorId: a.value,
                timestamp: a.score
              })),
              redisKey: key
            });
          }
        }
      }

      return batches;
    } catch (error) {
      sError('Error getting pending notification aggregations:', error);
      throw error;
    }
  }

  /**
   * Clear processed aggregation
   */
  async clearNotificationAggregation(key: string, recipientId: string): Promise<void> {
    try {
      await redisClient.del(key);

      // Check if recipient has any more pending aggregations
      const remaining = await this.scanKeys(`notif_agg:${recipientId}:*`);
      if (remaining.length === 0) {
        await redisClient.sRem('notif_agg:pending_recipients', recipientId);
      }

      sDebug(` Cleared notification aggregation: ${key}`);
    } catch (error) {
      sError('Error clearing notification aggregation:', error);
      throw error;
    }
  }

  /**
   * Get notification metadata (aggregation data)
   */
  async getNotificationMetadata(notificationId: string): Promise<any | null> {
    try {
      const data = await redisClient.hGetAll(`notif_meta:${notificationId}`);

      if (!data || Object.keys(data).length === 0) {
        return null;
      }

      return {
        actorIds: data.actorIds ? JSON.parse(data.actorIds) : [],
        count: parseInt(data.count || '1'),
        sampleActors: data.sampleActors ? JSON.parse(data.sampleActors) : []
      };
    } catch (error) {
      sError('Error getting notification metadata:', error);
      return null;
    }
  }

  /**
   * Set notification metadata (aggregation data)
   */
  async setNotificationMetadata(
    notificationId: string,
    actorIds: string[],
    count: number,
    sampleActors: string[]
  ): Promise<void> {
    try {
      await redisClient.hSet(`notif_meta:${notificationId}`, {
        actorIds: JSON.stringify(actorIds),
        count: count.toString(),
        sampleActors: JSON.stringify(sampleActors)
      });

      // Set TTL (7 days)
      await redisClient.expire(`notif_meta:${notificationId}`, 604800);
    } catch (error) {
      sError('Error setting notification metadata:', error);
      throw error;
    }
  }
  // #region Analytics
  /**
   * Record a profile visit with hourly deduplication
   */
  async recordProfileVisit(profileId: string, userId: string): Promise<boolean> {
    const dedupKey = `analytics:visit:${profileId}:${userId}`;
    const exists = await redisClient.exists(dedupKey);

    if (exists) return false;

    // Set hourly deduplication
    await redisClient.set(dedupKey, '1', { EX: 3600 });

    // Stream the event
    await redisClient.xAdd('analytics:events', '*', {
      type: 'profile_visit',
      profileId: profileId.toString(),
      userId: userId.toString(),
      ts: Date.now().toString()
    });

    return true;
  }

  /**
   * Stream a watch time heartbeat
   */
  async streamWatchHeartbeat(contentId: string, userId: string, duration: number, deviceType: string = 'web') {
    await redisClient.xAdd('analytics:watch_streams', '*', {
      contentId: contentId.toString(),
      userId: userId.toString(),
      duration: duration.toString(),
      deviceType,
      ts: Date.now().toString()
    });
  }

  /**
   * Pop events from analytics stream for batch processing (used by worker)
   */
  async getPendingAnalyticsEvents(stream: string, count: number = 500) {
    try {
      // Create consumer group if not exists
      try {
        await redisClient.xGroupCreate(stream, 'analytics_group', '0', { MKSTREAM: true });
      } catch (e: any) {
        // Group already exists, ignore
      }

      const results = await redisClient.xReadGroup(
        'analytics_group',
        'consumer_1',
        [{ key: stream, id: '>' }],
        { COUNT: count, BLOCK: 0 }
      ) as any;

      if (!results || results.length === 0) return [];

      const messages = results[0].messages.map((m: any) => ({
        id: m.id,
        data: m.message
      }));

      return messages;
    } catch (error) {
      sError(`Error reading stream ${stream}:`, error);
      return [];
    }
  }

  /**
   * Acknowledge and delete processed messages
   */
  async ackAnalyticsEvents(stream: string, messageIds: string[]) {
    if (messageIds.length === 0) return;
    await redisClient.xAck(stream, 'analytics_group', messageIds);
    await redisClient.xDel(stream, messageIds);
  }
  // #endregion

  // #region Seen Posts tracking (Feed Diversity)
  /**
   * Get post IDs the user has recently seen
   */
  async getSeenPosts(userId: string): Promise<string[]> {
    try {
      const key = `user:${userId}:seen_posts_z`;

      // Get the 1000 most recently seen posts
      return await Promise.race([
        redisClient.zRange(key, 0, 1000, { REV: true }),
        new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 3000))
      ]);
    } catch (error: any) {
      sError(`Error getting seen posts for user ${userId}: ${error.message}`);
      // Fallback to legacy key just in case
      try {
        return await redisClient.sMembers(`user:${userId}:seen_posts`);
      } catch {
        return [];
      }
    }
  }

  /**
   * Mark posts as seen for a user with a sliding TTL
   */
  async markPostsAsSeen(userId: string, postIds: string[], ttlSeconds: number = 3600 * 24) {
    if (postIds.length === 0) return;

    try {
      const key = `user:${userId}:seen_posts_z`;
      const now = Date.now();

      // Limit to max 100 posts per batch
      const limitedPostIds = postIds.slice(0, 100);

      // Use a pipeline for efficiency
      const pipeline = redisClient.multi();

      for (const id of limitedPostIds) {
        pipeline.zAdd(key, { score: now, value: id });
      }

      // Cap the set at 2000 items to prevent infinite growth
      pipeline.zRemRangeByRank(key, 0, -2001);

      // Extend TTL (24 hours for seen history)
      pipeline.expire(key, ttlSeconds);

      await Promise.race([
        pipeline.exec(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 4000))
      ]);
    } catch (error: any) {
      sError(`Error marking posts as seen for user ${userId}: ${error.message}`);
    }
  }
  // #endregion

  // #region Generic Cache
  async get(key: string): Promise<string | null> {
    try {
      return await redisClient.get(key);
    } catch (error) {
      sError(`Error getting key ${key} from Redis:`, error);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await redisClient.set(key, value, { EX: ttlSeconds });
      } else {
        await redisClient.set(key, value);
      }
    } catch (error) {
      sError(`Error setting key ${key} in Redis:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redisClient.del(key);
    } catch (error) {
      sError(`Error deleting key ${key} from Redis:`, error);
    }
  }

  async isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try {
      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }
      return current > limit;
    } catch (error) {
      sError(`Error checking rate limit for key ${key}:`, error);
      return false; // Fail open
    }
  }

  // #endregion

}

export default new RedisService();