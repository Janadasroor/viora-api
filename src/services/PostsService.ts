import { pool } from '../config/pg.config.js';
import postsRepository from '../repositories/PostsRepository.js';
import userRepository from '../repositories/UserRepository.js';
import notificationsService from '../services/NotificationsService.js';
import mediaCleanUpQueue from '../jobs/queues/mediaCleanupQueue.js';
import type { PoolClient } from 'pg';
import qdrantService from './QdrantService.js';
import cassandraFeedRepository from '../repositories/CassandraFeedRepository.js';
import type { Post, MediaFile, MediaFileInput, GetPostsParams, UpdatePostParams, GetSavedPostsParams, SavedPost, CreatePostParams, MediaDeleteRequest } from '@types';
import { sDebug } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';

class PostsService {
  /**
   * Get posts with filters and pagination
   */
  async getPosts({
    page = 1,
    limit = 20,
    cursor,
    userId,
    hashtag,
    type,
    requesterId,
    sharedBy,
    taggedUser
  }: GetPostsParams): Promise<{ posts: Post[], nextCursor?: string }> {
    const safePage = Math.max(1, parseInt(String(page), 10));
    const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10)));

    // Get posts
    return await postsRepository.getPosts({
      page: safePage,
      limit: safeLimit,
      cursor,
      userId: userId,
      hashtag: hashtag,
      type: type,
      requesterId,
      sharedBy,
      taggedUser
    });
  }

  /**
   * Mark multiple posts as seen
   */
  async markPostsAsSeen(userId: string, postIds: string[]): Promise<void> {
    if (!userId || !postIds || postIds.length === 0) {
      throw new Error('User ID and post IDs are required');
    }

    await postsRepository.markPostsAsSeen(userId, postIds);
  }

  /**
   * Get a single post by ID with all details
   */
  async getPostById(postId: string, requesterId: string | null = null): Promise<Post | null> {
    if (!postId) {
      throw new Error('Post ID is required');
    }

    const post = await postsRepository.getPostById(postId, requesterId);

    if (!post) {
      return null;
    }

    // Ensure media is an array
    if (!Array.isArray(post.media)) {
      post.media = post.media ? [post.media] : [];
    }

    // Ensure hashtags is a string
    post.hashtags = post.hashtags || '';

    // Convert boolean fields
    post.userLiked = Boolean(post.userLiked);
    post.userSaved = Boolean(post.userSaved);

    return toCamel(post);
  }

  /**
   * Create a new post with media and hashtags
   */
  async createPost({
    userId,
    caption,
    postType = 'photo',
    visibility = 'public',
    location = '',
    hashtags = [],
    mediaFiles = [],
    status
  }: CreatePostParams): Promise<{ postId: string }> {
    if (!userId) {
      throw new Error('User ID is required');
    }
    const client: PoolClient = await pool.connect();

    try {
      await client.query('BEGIN');
      const createStart = performance.now();

      // Determine initial status: use explicit status from frontend if provided, 
      // otherwise fallback to auto-detection (published for text-only, processing for media)
      let initialStatus = status;
      if (!initialStatus) {
        initialStatus = (mediaFiles && mediaFiles.length > 0) ? 'processing' : 'published';
      }

      // Create the post
      const postId = await postsRepository.createPost(client, {
        userId,
        caption,
        postType,
        visibility,
        location,
        status: initialStatus
      });
      const createEnd = performance.now();
      sDebug(`Creating post (${initialStatus}) took ${createEnd - createStart} milliseconds`);
      // Insert post media
      const start = performance.now();
      // Process hashtags
      if (hashtags && hashtags.length > 0) {
        const validHashtags = this._sanitizeHashtags(hashtags);

        for (const tagName of validHashtags) {
          const hashtagId = await postsRepository.getOrCreateHashtag(client, tagName);
          await postsRepository.linkHashtagToPost(client, postId, hashtagId);
        }
      }
      const end = performance.now();
      sDebug(`Processing hashtags took ${end - start} milliseconds`);

      // Process mentions
      let mentionsToNotify: string[] = [];
      const mentionMatches = caption.match(/@(\w+)/g);
      if (mentionMatches && mentionMatches.length > 0) {
        const usernames = [...new Set(mentionMatches.map(m => m.substring(1)))];
        if (usernames.length > 0) {
          try {
            const users = await userRepository.getUsersByUsernames(usernames);
            const mentionedUserIds = users
              .filter(u => u.userId !== userId)
              .map(u => u.userId);

            if (mentionedUserIds.length > 0) {
              await postsRepository.createMentions(client, postId, userId, mentionedUserIds);
              mentionsToNotify = mentionedUserIds;
            }
          } catch (e) {
            sDebug('Failed to process mentions:', e);
          }
        }
      }

      // Update user's post count
      await postsRepository.incrementUserPostCount(client, userId);

      await client.query('COMMIT');

      if (mentionsToNotify.length > 0) {
        mentionsToNotify.forEach(uid => {
          notificationsService.notify({
            recipientId: uid,
            actorId: userId,
            notificationType: 'mention',
            targetType: 'post',
            targetId: postId,
            message: 'mentioned you in a post',
            sendPush: true
          }).catch(e => sDebug(`Failed to notify user ${uid} about mention:`, e));
        });
      }

      // Trigger post processing (embedding)
      const { addPostProcessingJob } = await import('../jobs/queues/postsQueue.js');
      addPostProcessingJob({ postId, caption, userId }).catch(err => {
        sDebug(`Failed to queue post processing for ${postId}:`, err);
      });

      return { postId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing post
   */
  async updatePost(
    postId: string,
    userId: string,
    { caption = '', location = null, visibility = 'PUBLIC' }: UpdatePostParams
  ): Promise<void> {
    if (!postId || !userId) {
      throw new Error('Post ID and User ID are required');
    }

    // Verify ownership
    const post = await postsRepository.getPostOwner(postId);

    if (!post) {
      throw new Error('Post not found');
    }

    if (post.userId !== userId) {
      throw new Error('Unauthorized: You do not own this post');
    }

    await postsRepository.updatePost(postId, { caption, location, visibility });
  }

  /**
   * Delete a post (soft delete)
   */
  async deletePost(postId: string, userId: string, isAdmin = false): Promise<void> {
    if (!postId || !userId) {
      throw new Error('Post ID and User ID are required');
    }
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verify ownership or admin access
      const post = await postsRepository.getPostOwner(postId);

      if (!post) {
        throw new Error('Post not found');
      }
      if (post.userId !== userId && !isAdmin) {
        throw new Error('Unauthorized: You do not own this post');
      }

      // delete the post
      mediaCleanUpQueue.addCleanUp({
        userId: userId,
        targetId: postId,
        targetType: 'POST'
      } as MediaDeleteRequest);

      // Clean up Qdrant and Cassandra
      await qdrantService.deletePostCaptionEmbeddings(postId);
      await cassandraFeedRepository.deletePostMetadata(postId);

      // Update user's posts count
      await postsRepository.decrementUserPostCount(client, post.userId);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get saved posts for a user
   */
  async getSavedPosts({
    userId,
    collectionId = null,
    limit = 20,
    offset = 0
  }: GetSavedPostsParams): Promise<SavedPost[]> {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10)));
    const safeOffset = Math.max(0, parseInt(String(offset), 10));

    const savedPosts = await postsRepository.getSavedPosts({
      userId,
      collectionId,
      limit: safeLimit,
      offset: safeOffset
    });
    return toCamel(savedPosts);
  }

  /**
   * Save a post to user's collection
   */
  async savePost(userId: string, postId: string, collectionId: string | null = null): Promise<void> {
    if (!userId || !postId) {
      throw new Error('User ID and Post ID are required');
    }

    await postsRepository.savePost(userId, postId, collectionId);
  }

  /**
   * Remove a post from user's saved collection
   */
  async unsavePost(userId: string, postId: string): Promise<void> {
    if (!userId || !postId) {
      throw new Error('User ID and Post ID are required');
    }

    await postsRepository.unsavePost(userId, postId);
  }

  /**
   * Share a post
   */
  async sharePost(userId: string, postId: string): Promise<void> {
    if (!userId || !postId) {
      throw new Error('User ID and Post ID are required');
    }

    await postsRepository.sharePost(userId, postId);

    // Optional: Trigger notification logic here if needed
  }

  /**
   * Unshare a post
   */
  async unsharePost(userId: string, postId: string): Promise<void> {
    if (!userId || !postId) {
      throw new Error('User ID and Post ID are required');
    }

    await postsRepository.unsharePost(userId, postId);
  }

  /**
   * Sanitize hashtags - remove special characters and ensure valid format
   * @private
   */
  private _sanitizeHashtags(hashtags: string[]): string[] {
    return hashtags
      .map((tag) => tag.toLowerCase().replace(/[^a-z0-9_]/g, ''))
      .filter((tag) => tag.length > 0 && tag.length <= 50)
      .slice(0, 30); // Limit to 30 hashtags per post
  }
}

export default new PostsService();