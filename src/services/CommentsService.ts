import commentsRepository from '../repositories/CommentsRepository.js';
import { pool } from '../config/pg.config.js';
import notificationsService from './NotificationsService.js';
import userRepository from '../repositories/UserRepository.js';
import userService from './UserService.js';
import { commentsQueue } from '../jobs/queues/commentsQueue.js';
import { getIO } from '../utils/socketManager.js';
import redisService, { RedisService } from '../cache/RedisService.js';
import type { PoolClient } from 'pg';
import type { Comment, CommentData, Reply } from '@types';
import { sDebug, sError, sInfo, sLog } from 'sk-logger';

interface CreateCommentParams {
  content: string;
  parentCommentId?: string | null;
  postId: string;
  userId: string;
}

interface UpdateCommentParams {
  commentId: string;
  userId: string;
  content: string;
}

interface DeleteCommentParams {
  commentId: string;
  userId: string;
}



interface IncrementCommentResult {
  commentId: string;
  shouldProcessNow: boolean;
  [key: string]: any;
}

class CommentsService {
  private cache: RedisService;

  constructor() {
    this.cache = redisService;
  }
  /**
   * Get comments for a post
   */
  /**
   * Extract usernames from content (e.g., @username)
   */
  private extractMentions(content: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const matches = content.match(mentionRegex);
    if (!matches) return [];
    return matches.map(match => match.substring(1));
  }

  /**
   * Private helper to broadcast a new comment to a socket room.
   * Leverages UserService for caching and ensures non-blocking execution.
   */
  private async broadcastComment({
    commentId,
    targetId,
    targetType,
    userId,
    content,
    parentCommentId
  }: {
    commentId: string;
    targetId: string;
    targetType: 'post' | 'reel' | 'story';
    userId: string;
    content: string;
    parentCommentId?: string | null | undefined;
  }) {
    try {
      const user = await userService.getUserById(userId);
      const io = getIO();
      const broadcastData = {
        commentId,
        [`${targetType}Id`]: targetId,
        userId,
        content,
        username: user?.username || 'Unknown',
        displayName: user?.displayName || user?.username || 'Unknown',
        userMedia: user?.userMedia || user?.media || [],
        createdAt: new Date().toISOString(),
        parentCommentId
      };
      io.to(`${targetType}_${targetId}`).emit('newComment', broadcastData);
      sLog(`[CommentsService] Broadcasted new ${targetType} comment ${commentId}`);
    } catch (error) {
      sError(`[CommentsService] broadcastComment failed for ${targetType}:`, error);
    }
  }

  /**
   * Handle mention notifications
   */
  private async handleMentions(content: string, actorId: string, targetId: string, targetType: string): Promise<void> {
    const usernames = this.extractMentions(content);
    if (usernames.length === 0) return;

    try {
      const users = await userRepository.getUsersByUsernames(usernames);
      const actor = await userRepository.getUserById(actorId);

      for (const user of users) {
        // Don't notify yourself
        if (user.userId === actorId) continue;

        await notificationsService.notify({
          recipientId: user.userId,
          actorId,
          notificationType: 'mention',
          targetType: targetType === 'post' ? 'post' : 'reel',
          targetId,
          message: `${actor?.username || 'Someone'} mentioned you in a comment`
        });
      }
    } catch (error) {
      sError('Failed to handle mentions:', error);
    }
  }

  async getComments(
    cursor: string | null,
    limit: number,
    targetId: string,
    targetType: "reel" | "post" | "comment",
    userId?: string
  ): Promise<{ comments: Comment[]; nextCursor?: string }> {
    try {
      const cacheKey = `comments:${targetType}:${targetId}:${cursor || 'start'}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const result = await commentsRepository.getComments(
        targetId,
        targetType,
        cursor,
        limit,
        userId
      );

      // Cache for 30 seconds
      await this.cache.set(cacheKey, JSON.stringify(result), 30);

      return result;
    } catch (error) {
      sError("Error in getComments service:", error);
      throw error;
    }
  }

  /**
   * Get replies for a comment
   */
  async getCommentReplies(
    cursor: string | null,
    limit: number,
    commentId: string,
    userId?: string
  ): Promise<{ replies: Reply[]; nextCursor?: string }> {
    try {
      const cacheKey = `replies:${commentId}:${cursor || 'start'}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const result = await commentsRepository.getCommentReplies(
        commentId,
        cursor,
        limit,
        userId
      );

      await this.cache.set(cacheKey, JSON.stringify(result), 30);
      return result;
    } catch (error) {
      sError("Error in getCommentReplies service:", error);
      throw error;
    }
  }

  /**
   * Create a new comment reply
   */


  /**
   * Create a new comment
   */
  async commentPost({
    content,
    parentCommentId,
    postId,
    userId
  }: CreateCommentParams): Promise<{ success: boolean; commentId: string }> {
    try {
      // 1. Validation
      const cleanContent = content?.trim() || '';
      if (!cleanContent) {
        throw new Error('Comment content is required');
      }
      if (cleanContent.length > 2000) {
        throw new Error('Comment content too long (max 2000 characters)');
      }

      // 2. Rate Limiting (5 comments per 60 seconds)
      const isLimited = await this.cache.isRateLimited(`rate_limit:comments:${userId}`, 500, 60);
      if (isLimited) {
        throw new Error('Too many comments. Please wait a minute.');
      }

      const data: IncrementCommentResult = await redisService.incrementComment(
        postId,
        userId,
        cleanContent,
        new Date(),
        parentCommentId
      );

      sDebug(`[CommentsService] incrementComment result:`, data);

      // Immediate processing for viral posts
      if (data.shouldProcessNow) {
        sDebug(`Processing comment for post ${postId} immediately`);
        await commentsQueue.addCommentJob(data.commentId, { priority: 1 });
      }


      // Broadcast to all users in the post room (Fire-and-forget)
      this.broadcastComment({
        commentId: data.commentId,
        targetId: postId,
        targetType: 'post',
        userId,
        content: cleanContent,
        parentCommentId
      }).catch(err => sError('Socket broadcast failed for post comment:', err));

      // Handle mentions asynchronously
      this.handleMentions(content, userId, postId, 'post').catch(err => sError('Failed to handle mentions for post comment:', err));

      return { success: true, commentId: data.commentId };
    } catch (error) {
      sError('Error in createComment:', error);
      throw error;
    }
  }

  //#region Deprecated methods
  /**
   * Old createComment implementation - kept for reference
   * 
   * async createComment({ content, parentCommentId, postId, userId }: CreateCommentParams): Promise<boolean> {
   *   const client = await pool.connect();
   * 
   *   try {
   *     await client.query('BEGIN');
   * 
   *     // Verify post
   *     const post = await commentsRepository.verifyPostExists(postId);
   *     if (!post) throw new Error("Post not found");
   * 
   *     // Verify parent comment if reply
   *     let commentOwnerId: string | null = null;
   *     if (parentCommentId) {
   *       const parentComment = await commentsRepository.verifyParentComment(parentCommentId, postId);
   *       if (!parentComment) throw new Error("Parent comment not found");
   *     }
   * 
   *     // Insert comment
   *     const { commentId } = await commentsRepository.insertComment({
   *       postId,
   *       userId,
   *       parentCommentId,
   *       content
   *     });
   * 
   *     // If reply, increment parent comment repliesCount
   *     if (parentCommentId) {
   *       await commentsRepository.incrementReplyCount(parentCommentId);
   *       const parentCommentOwner = await commentsRepository.getCommentOwner(parentCommentId);
   *       commentOwnerId = parentCommentOwner.userId;
   *     }
   * 
   *     // Notifications
   *     if (parentCommentId) {
   *       // Reply notification
   *       await createNotification({
   *         recipientId: commentOwnerId,
   *         actorId: userId,
   *         type: "comment",
   *         targetType: "comment",
   *         targetId: parentCommentId,
   *         message: "replied to your comment"
   *       });
   *     } else {
   *       // Comment on post notification
   *       await createNotification({
   *         recipientId: post.userId,
   *         actorId: userId,
   *         type: "comment",
   *         targetType: "post",
   *         targetId: postId,
   *         message: "commented on your post"
   *       });
   *     }
   * 
   *     await client.query('COMMIT');
   *     return true;
   *   } catch (error) {
   *     await client.query('ROLLBACK');
   *     console.error("Error in createComment:", error);
   *     throw error;
   *   } finally {
   *     client.release();
   *   }
   * }
   */
  //#endregion

  /**
   * Update an existing comment
   */
  async updateComment({
    commentId,
    userId,
    content
  }: UpdateCommentParams): Promise<boolean> {
    try {
      if (!content || content.trim().length === 0) {
        throw new Error('Comment content is required');
      }
      if (content.trim().length > 2000) {
        throw new Error('Comment content too long (max 2000 chars)');
      }

      const comment: CommentData | undefined = await commentsRepository.findCommentById(commentId);
      if (!comment) throw new Error('Comment not found');

      if (comment.userId !== userId) throw new Error('Unauthorized');

      // Check 24h edit window
      const commentAge = Date.now() - new Date(comment.createdAt).getTime();
      if (commentAge > 24 * 60 * 60 * 1000) {
        throw new Error('Comment too old to edit');
      }

      await commentsRepository.updateCommentContent(commentId, content);
      return true;
    } catch (error) {
      sError('Error in updateComment:', error);
      throw error;
    }
  }

  /**
   * Delete a comment and its replies
   */
  async deleteComment({ commentId, userId }: DeleteCommentParams): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const comment: CommentData | undefined = await commentsRepository.findCommentById(commentId);
      if (!comment) throw new Error('Comment not found');
      if (comment.userId !== userId) throw new Error('Unauthorized');

      // Delete replies first
      const repliesCount: number = await commentsRepository.countReplies(commentId);
      if (repliesCount > 0) {
        await commentsRepository.deleteReplies(commentId);
      }

      // Delete main comment
      await commentsRepository.deleteComment(commentId);

      // Adjust parent comment reply count if needed
      if (comment.parentCommentId) {
        await commentsRepository.decrementReplyCount(comment.parentCommentId);
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      sError('Error in deleteComment:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Add a comment to a reel
   */
  async commentReel(
    userId: string,
    reelId: string,
    commentText: string,
    parentCommentId: string | null = null
  ): Promise<{ success: boolean; commentId: string }> {
    try {
      // 1. Validation
      const cleanContent = commentText?.trim() || '';
      if (!cleanContent) {
        throw new Error('Comment content is required');
      }
      if (cleanContent.length > 2000) {
        throw new Error('Comment content too long (max 2000 characters)');
      }

      // 2. Rate Limiting
      const isLimited = await this.cache.isRateLimited(`rate_limit:comments:${userId}`, 500, 60);
      if (isLimited) {
        throw new Error('Too many comments. Please wait a minute.');
      }

      const data = await redisService.incrementReelComment(
        reelId,
        userId,
        cleanContent,
        new Date(),
        parentCommentId
      );
      if (data.shouldProcessNow) {
        sInfo(`Processing comment for reel ${reelId} immediately`);
        await commentsQueue.addReelCommentJob(data.commentId, { priority: 1 });
      }


      // Broadcast to all users in the reel room (Fire-and-forget)
      this.broadcastComment({
        commentId: data.commentId,
        targetId: reelId,
        targetType: 'reel',
        userId,
        content: cleanContent,
        parentCommentId
      }).catch(err => sError('Socket broadcast failed for reel comment:', err));

      // Handle mentions asynchronously
      this.handleMentions(commentText, userId, reelId, 'reel').catch(err => sError('Failed to handle mentions for reel comment:', err));

      return { success: true, commentId: data.commentId };
    } catch (error: any) {
      sError('Error commenting on reel:', error);
      throw error;
    }
  }

  /**
   * Delete a reel comment
   */
  async deleteReelComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false
  ): Promise<any> {
    try {
      const result = await commentsRepository.deleteReelComment(
        userId,
        commentId,
        isAdmin
      );
      return result;
    } catch (error) {
      throw new Error('Error deleting comment');
    }
  }

  /**
   * Add a comment to a story
   */
  async commentStory(
    userId: string,
    storyId: string,
    commentText: string,
    parentCommentId: string | null = null
  ): Promise<{ success: boolean; commentId: string }> {
    try {
      const cleanContent = commentText?.trim() || '';
      if (!cleanContent) {
        throw new Error('Comment content is required');
      }
      if (cleanContent.length > 2000) {
        throw new Error('Comment content too long (max 2000 characters)');
      }

      const isLimited = await this.cache.isRateLimited(`rate_limit:comments:${userId}`, 500, 60);
      if (isLimited) {
        throw new Error('Too many comments. Please wait a minute.');
      }

      const data = await redisService.incrementStoryComment(
        storyId,
        userId,
        cleanContent,
        new Date(),
        parentCommentId
      );

      if (data.shouldProcessNow) {
        sInfo(`Processing comment for story ${storyId} immediately`);
        await commentsQueue.addStoryCommentJob(data.commentId, { priority: 1 });
      }

      this.broadcastComment({
        commentId: data.commentId,
        targetId: storyId,
        targetType: 'story',
        userId,
        content: cleanContent,
        parentCommentId
      }).catch(err => sError('Socket broadcast failed for story comment:', err));

      this.handleMentions(commentText, userId, storyId, 'story').catch(err => sError('Failed to handle mentions for story comment:', err));

      return { success: true, commentId: data.commentId };
    } catch (error: any) {
      sError('Error commenting on story:', error);
      throw error;
    }
  }

  /**
   * Delete a story comment
   */
  async deleteStoryComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false
  ): Promise<any> {
    try {
      const result = await commentsRepository.deleteComment(commentId);
      return result;
    } catch (error) {
      throw new Error('Error deleting story comment');
    }
  }
}

export default new CommentsService();