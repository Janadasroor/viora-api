import { pool } from '../config/pg.config.js';
import type { PoolClient, QueryResult } from 'pg';
import type {
  Post, MediaFile, MediaFileInput,
  GetPostsParams, UpdatePostParams,
  GetSavedPostsParams, CreatePostParams, SavedPost
} from '@types';
import { sDebug, sError } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';
import mediaRepository from './MediaRepository.js';

class PostsRepository {
  /**
   * Get posts with filters and pagination
   */
  async getPosts({ cursor, limit, userId, hashtag, type, requesterId, sharedBy, taggedUser }: GetPostsParams): Promise<{ posts: Post[], nextCursor?: string }> {
    const filterUserId = sharedBy || userId;

    let cursorDate: Date | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('ascii');
        const [dateStr, idStr] = decoded.split('|');
        if (dateStr && idStr) {
          cursorDate = new Date(dateStr);
          cursorId = idStr;
        }
      } catch (e) {
        sError('Invalid posts cursor:', e);
      }
    }

    let query = `
      SELECT
      p.post_id,
        p.user_id,
        p.caption,
        p.post_type,
        p.visibility,
        p.location,
        p.likes_count::text,
        p.shares_count::text,
        p.comments_count::text,
        p.views_count::text,
        p.created_at,
        u.username,
        u.is_online,
        up.display_name,
        up.is_verified,
        ${filterUserId ? `CASE WHEN ps.share_id IS NOT NULL THEN true ELSE false END as is_shared, ps.shared_at,` : `false as is_shared, NULL as shared_at,`}
        ${requesterId ? `
          EXISTS(
            SELECT 1 FROM likes 
            WHERE target_type = 'post' 
              AND target_id = p.post_id 
              AND user_id = $1
          ) as user_liked,
          EXISTS(
            SELECT 1 FROM saved_posts 
            WHERE saved_id = p.post_id 
              AND user_id = $2
          ) as user_saved,
          EXISTS(
            SELECT 1 FROM follows 
            WHERE following_id = p.user_id 
              AND follower_id = $1
              AND status = 'accepted'
          ) as is_following,
        ` : 'false as user_liked, false as user_saved, false as is_following,'
      }
STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) as hashtags
      FROM posts p 
      JOIN users u ON p.user_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
      LEFT JOIN post_hashtags ph ON p.post_id = ph.post_id
      LEFT JOIN hashtags h ON ph.hashtag_id = h.hashtag_id
      ${filterUserId ? `LEFT JOIN post_shares ps ON p.post_id = ps.post_id AND ps.user_id = $${requesterId ? 3 : 1}` : ''}
      WHERE p.is_archived = false 
        AND p.status = 'published'
        AND u.account_status = 'active'
  `;

    const params: any[] = requesterId ? [requesterId, requesterId] : [];
    let paramIndex = params.length + 1;

    if (sharedBy) {
      query += ` AND ps.share_id IS NOT NULL AND ps.user_id = $${paramIndex} `;
      params.push(sharedBy);
      paramIndex++;
    } else if (userId) {
      query += ` AND (p.user_id = $${paramIndex} OR ps.share_id IS NOT NULL) `;
      params.push(userId);
      paramIndex++;
    }

    if (hashtag) {
      query += ` AND EXISTS(
        SELECT 1 FROM post_hashtags ph2 
        JOIN hashtags h2 ON ph2.hashtag_id = h2.hashtag_id 
        WHERE ph2.post_id = p.post_id AND h2.tag_name = $${paramIndex}
      )`;
      params.push(hashtag);
      paramIndex++;
    }

    if (taggedUser) {
      query += ` AND EXISTS(
            SELECT 1 FROM mentions m
            WHERE m.target_id::text = p.post_id::text
            AND m.target_type = 'post'
            AND m.mentioned_user_id = $${paramIndex}
        )`;
      params.push(taggedUser);
      paramIndex++;
    }

    if (type) {
      query += ` AND p.post_type = $${paramIndex} `;
      params.push(type);
      paramIndex++;
    }

    // Add cursor condition
    if (cursorDate && cursorId) {
      const orderColumn = filterUserId ? `COALESCE(ps.shared_at, p.created_at)` : `p.created_at`;
      query += ` AND (${orderColumn} < $${paramIndex++} OR (${orderColumn} = $${paramIndex - 1} AND p.post_id < $${paramIndex++})) `;
      params.push(cursorDate, cursorId);
    }

    query += ` 
      GROUP BY
        p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
        p.location, p.likes_count, p.shares_count, p.comments_count, p.views_count, p.created_at,
        u.user_id, u.username, u.is_online,
        up.user_id, up.display_name, up.is_verified
        ${filterUserId ? `, ps.share_id, ps.shared_at` : ''}

      ORDER BY ${filterUserId ? `COALESCE(ps.shared_at, p.created_at)` : `p.created_at`} DESC, p.post_id DESC
      LIMIT $${paramIndex}
    `;

    params.push(limit);

    const result = await pool.query(query, params);
    const posts = result.rows;

    if (posts.length > 0) {
      // Fetch user media
      const userIds = [...new Set(posts.map((p: any) => p.user_id))];
      const userMediaMap = await mediaRepository.getUsersMedia(userIds);
      // Fetch post media
      const postIds = [...new Set(posts.map((p: any) => p.post_id))];
      const postMediaMap = await mediaRepository.getPostsMedia(postIds);

      posts.forEach((post: any) => {
        post.user_media = userMediaMap[post.user_id] || [];
        post.media = postMediaMap[post.post_id] || [];
      });
    }

    let nextCursor: string | undefined;
    if (posts.length === parseInt(String(limit), 10)) {
      const lastPost = posts[posts.length - 1];
      const lastDate = filterUserId ? (lastPost.shared_at || lastPost.created_at) : lastPost.created_at;
      nextCursor = Buffer.from(`${lastDate.toISOString()}|${lastPost.post_id}`).toString('base64');
    }

    const response: { posts: Post[], nextCursor?: string } = {
      posts: toCamel(posts)
    };

    if (nextCursor) {
      response.nextCursor = nextCursor;
    }

    return response;
  }

  /**
   * Mark posts as seen by a user
   */
  async markPostsAsSeen(userId: string, postIds: string[]): Promise<void> {
    if (!postIds || postIds.length === 0) return;

    // Use a values builder for multiple insertions
    const values = postIds.map((_, i) =>
      `($1, $${i + 2}, NOW())`
    ).join(',');

    const query = `
      INSERT INTO saved_posts(user_id, saved_id, saved_at)
      VALUES ${values}
      ON CONFLICT (user_id, saved_id) DO NOTHING
    `;

    const params = [userId, ...postIds];
    await pool.query(query, params);
  }

  /**
   * Get a single post by ID with all details
   */
  async getPostById(postId: string, requesterId: string | null = null): Promise<Post | null> {
    const query = `
SELECT
p.post_id,
  p.user_id,
  p.caption,
  p.post_type,
  p.visibility,
  p.location,
  p.likes_count::text,
  p.shares_count::text,
  p.comments_count::text,
  p.views_count::text,
  p.created_at,
  p.updated_at,
  p.is_archived,
  u.username,
  u.is_online,
  up.display_name,
  up.display_name,
  up.is_verified,
  ${requesterId ? `
      EXISTS(
        SELECT 1 FROM likes 
        WHERE target_type = 'post' 
          AND target_id = p.post_id 
          AND user_id = $1
      ) AS user_liked,
      EXISTS(
        SELECT 1 FROM saved_posts 
        WHERE saved_id = p.post_id 
          AND user_id = $2
      ) AS user_saved,
` : `      false AS user_liked, 
      false AS user_saved,
`}
(
  SELECT STRING_AGG(h2.tag_name, ',')
FROM(
  SELECT DISTINCT h.tag_name
          FROM post_hashtags ph2
          JOIN hashtags h ON ph2.hashtag_id = h.hashtag_id
          WHERE ph2.post_id = p.post_id
) h2
      ) AS hashtags,
  (
    SELECT JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'media_id', m2.id,
        'file_path', m2.original_path,
        'mime_type', m2.mime_type,
        'media_type', m2.type,
        'width', m2.width,
        'height', m2.height,
        'thumbnail_path', m2.thumbnail_path,
        'thumbnail_width', m2.thumbnail_width,
        'thumbnail_height', m2.thumbnail_height,
        'file_name', m2.original_filename,
        'alt_text', pm2.alt_text,
        'media_order', pm2.media_order,
        'duration', m2.duration,
        'aspect_ratio', m2.aspect_ratio,
        'codec', m2.codec,
        'bitrate', m2.bitrate,
        'fps', m2.fps,
        'has_audio', m2.has_audio,
        'status', m2.status,
        'variants', (
        SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'variant_id', vv.id,
            'quality', vv.quality_label,
            'resolution', vv.resolution,
            'file_path', vv.file_path,
            'file_size', vv.file_size,
            'bitrate', vv.bitrate,
            'codec', vv.codec,
            'format', vv.container,
            'width', vv.width,
            'height', vv.height,
            'fps', vv.fps,
            'status', vv.status
          ) ORDER BY vv.bitrate DESC
        )
              FROM video_variants vv
              WHERE vv.media_id = m2.id
      )
    ) ORDER BY pm2.media_order
        )
        FROM post_media pm2
        JOIN media m2 ON pm2.media_id = m2.id
        WHERE pm2.post_id = p.post_id
      ) AS media
    FROM posts p
    JOIN users u ON p.user_id = u.user_id
    JOIN user_profiles up ON u.user_id = up.user_id
    WHERE p.post_id = $${requesterId ? 3 : 1}
      AND p.is_archived = false
      AND p.status = 'published'
  `;
    const params = requesterId
      ? [requesterId, requesterId, postId]
      : [postId];

    const result = await pool.query(query, params);
    const post = result.rows[0];

    if (post) {
      // Fetch user media
      const userMediaMap = await mediaRepository.getUsersMedia([post.userId]);
      (post as any).user_media = userMediaMap[post.userId] || [];
    }

    return toCamel(post) || null;
  }

  /**
   * Create a new post
   */
  async createPost(client: PoolClient, { userId, caption, postType, visibility, location, status }: CreatePostParams): Promise<string> {
    const query = `
      INSERT INTO posts(user_id, caption, post_type, visibility, location, status)
      VALUES($1, $2, $3, $4, $5, $6) 
            RETURNING post_id
              `;

    const result = await client.query(query, [
      userId,
      caption,
      postType,
      visibility,
      location,
      status || 'processing'
    ]);

    return result.rows[0].post_id;
  }

  /**
   * Insert post media
   */
  async insertPostMedia(postId: string, mediaIds: string[]): Promise<void> {
    if (!mediaIds || mediaIds.length === 0) return;

    // generate placeholders: ($1, $2, $3), ($1, $4, $5), ...
    const values = mediaIds
      .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
      .join(', ');

    // build params: first postId, then mediaId and order pairs
    const params: any[] = [postId];
    mediaIds.forEach((mediaId, index) => {
      params.push(mediaId, index + 1);
    });

    const query = `
    INSERT INTO post_media(post_id, media_id, media_order)
    VALUES ${values}
`;

    await pool.query(query, params);
  }

  /**
   * Get or create a hashtag
   */
  async getOrCreateHashtag(client: PoolClient, tagName: string): Promise<string> {
    // Try to insert, ignore if exists
    let result = await client.query(
      `INSERT INTO hashtags(tag_name)
      VALUES($1)
       ON CONFLICT(tag_name) DO NOTHING
       RETURNING hashtag_id`,
      [tagName]
    );

    // If no rows returned, hashtag already exists - fetch it
    if (result.rows.length === 0) {
      result = await client.query(
        `SELECT hashtag_id FROM hashtags WHERE tag_name = $1`,
        [tagName]
      );
    }

    return result.rows[0].hashtag_id;
  }

  /**
   * Link hashtag to post
   */
  async linkHashtagToPost(client: PoolClient, postId: string, hashtagId: string): Promise<void> {
    await client.query(
      `INSERT INTO post_hashtags(post_id, hashtag_id)
      VALUES($1, $2)
      ON CONFLICT DO NOTHING`,
      [postId, hashtagId]
    );
  }

  /**
   * Increment user's post count
   */
  async incrementUserPostCount(client: PoolClient, userId: string, amount = 1): Promise<void> {
    await client.query(
      `UPDATE user_profiles 
       SET posts_count = posts_count + $1 
       WHERE user_id = $2`,
      [amount, userId]
    );
  }

  /**
   * Decrement user's post count
   */
  async decrementUserPostCount(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `UPDATE user_profiles 
       SET posts_count = GREATEST(posts_count - 1, 0) 
       WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Check if user owns a post
   */
  async getPostOwner(postId: string): Promise<{ userId: string } | null> {
    const result = await pool.query(
      'SELECT user_id FROM posts WHERE post_id = $1',
      [postId]
    );

    return toCamel(result.rows[0]) || null;
  }

  /**
   * Update post details
   */
  async updatePost(postId: string, { caption, location, visibility }: UpdatePostParams): Promise<void> {
    const query = `
      UPDATE posts 
      SET caption = $1,
      location = $2,
      visibility = $3,
      updated_at = CURRENT_TIMESTAMP 
      WHERE post_id = $4
  `;

    await pool.query(query, [caption, location, visibility, postId]);
  }

  /**
   * delete a post
   */
  async deletePost(userId: string, postId: string): Promise<void> {
    sDebug(`Deleting post ${postId} for user ${userId}`);
    await pool.query(
      'DELETE FROM posts WHERE post_id = $1 and user_id = $2',
      [postId, userId]
    );
  }

  /**
   * Update post status
   */
  async updatePostStatus(postId: string, status: string): Promise<void> {
    await pool.query(
      'UPDATE posts SET status = $1, updated_at = NOW() WHERE post_id = $2',
      [status, postId]
    );
  }

  /**
   * Get saved posts for a user
   */
  async getSavedPosts({ userId, collectionId, limit, offset }: GetSavedPostsParams): Promise<SavedPost[]> {
    try {
      let query = `
      SELECT
        p.post_id,
        p.user_id as post_owner,
        p.caption,
        p.post_type,
        p.visibility,
        p.location,
        p.latitude,
        p.longitude,
        p.is_archived,
        p.comments_disabled,
        p.likes_count::text,
        p.shares_count::text,
        p.comments_count::text,
        p.views_count::text,
        p.created_at as post_created_at,
        sp.saved_at as saved_at,
        u.username,
        u.user_id,
        u.is_online,
        up.display_name,
        up.is_verified,
        up.profile_picture_url,
        true as user_saved,
        EXISTS(
          SELECT 1 FROM likes 
          WHERE target_type = 'post' 
            AND target_id = p.post_id 
            AND user_id = $1
        ) as user_liked,
        EXISTS(
          SELECT 1 FROM follows 
          WHERE following_id = p.user_id 
            AND follower_id = $1
            AND status = 'accepted'
        ) as is_following,
        (
          SELECT STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) 
          FROM post_hashtags ph 
          JOIN hashtags h ON ph.hashtag_id = h.hashtag_id 
          WHERE ph.post_id = p.post_id
        ) as hashtags
      FROM saved_posts sp
      JOIN posts p ON sp.saved_id = p.post_id
      JOIN users u ON p.user_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
        WHERE sp.user_id = $1
      `;

      const params: any[] = [userId];
      let paramIndex = 2;

      if (collectionId) {
        query += ` AND sp.collection_id = $${paramIndex} `;
        params.push(collectionId);
        paramIndex++;
      }

      query += ` ORDER BY sp.saved_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1} `;
      params.push(limit, offset);

      const result = await pool.query(query, params);
      const posts = result.rows;

      if (posts.length > 0) {
        // Fetch user media (profile pictures are in user_profiles, but user_media might refer to posts content or strictly user uploaded media)
        // getPosts fetches user_media and media. Let's match that.
        const postIds = posts.map(p => p.post_id);
        const postUsers = [...new Set(posts.map(p => p.user_id))];

        const [postMediaMap, userMediaMap] = await Promise.all([
          mediaRepository.getPostsMedia(postIds),
          mediaRepository.getUsersMedia(postUsers)
        ]);

        posts.forEach(post => {
          post.media = postMediaMap[post.post_id] || [];
          post.user_media = userMediaMap[post.user_id] || [];
        });
      }

      return toCamel(posts);
    } catch (error) {
      sError("Error in getSavedPosts:", error);
      throw error;
    }
  }

  /**
   * Save a post to user's saved collection
   */
  async savePost(userId: string, postId: string, collectionId: string | null = null): Promise<void> {
    // Validate collection if provided
    let safeCollectionId: string | null = null;

    if (collectionId) {
      const collectionResult = await pool.query(
        'SELECT 1 FROM collections WHERE collection_id = $1',
        [collectionId]
      );

      // The collectionId logic is removed as per instruction.
      sDebug(userId, postId);
      await pool.query(
        `INSERT INTO saved_posts(user_id, saved_id)
       VALUES($1, $2)
       ON CONFLICT (user_id, saved_id) DO NOTHING`,
        [userId, postId]
      );
    }
  }

  /**
   * Remove a post from user's saved collection
   */
  async unsavePost(userId: string, postId: string): Promise<void> {
    await pool.query(
      'DELETE FROM saved_posts WHERE user_id = $1 AND saved_id = $2',
      [userId, postId]
    );
  }

  /**
   * Remove a post from user's saved collection (Alias for unsavePost)
   */
  async removeSavedPost(userId: string, postId: string): Promise<void> {
    return this.unsavePost(userId, postId);
  }

  /**
   * Share a post
   */
  async sharePost(userId: string, postId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert share record
      const result = await client.query(
        `INSERT INTO post_shares (user_id, post_id) 
         VALUES ($1, $2) 
         ON CONFLICT (user_id, post_id) DO NOTHING`,
        [userId, postId]
      );

      // Only increment if it was a new share
      if (result.rowCount && result.rowCount > 0) {
        await client.query(
          `UPDATE posts SET shares_count = shares_count + 1 WHERE post_id = $1`,
          [postId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Unshare a post
   */
  async unsharePost(userId: string, postId: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Remove share record
      const result = await client.query(
        `DELETE FROM post_shares 
         WHERE user_id = $1 AND post_id = $2`,
        [userId, postId]
      );

      // Only decrement if a record was actually deleted
      if (result.rowCount && result.rowCount > 0) {
        await client.query(
          `UPDATE posts SET shares_count = GREATEST(shares_count - 1, 0) WHERE post_id = $1`,
          [postId]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  /**
   * Create mentions
   */
  async createMentions(client: PoolClient, postId: string, userId: string, mentionedUserIds: string[]): Promise<void> {
    if (!mentionedUserIds || mentionedUserIds.length === 0) return;

    // target_type is 'post'
    const type = 'post';
    const baseParams = [type, postId, userId];
    const userParams = mentionedUserIds;
    const allParams = [...baseParams, ...userParams];

    const valueStrings = userParams.map((_, i) =>
      `($${i + 4}, $1, $2, $3)`
    ).join(', ');

    const query = `
      INSERT INTO mentions(mentioned_user_id, target_type, target_id, mentioned_by_user_id)
      VALUES ${valueStrings}
      ON CONFLICT DO NOTHING
    `;

    await client.query(query, allParams);
  }
}



export default new PostsRepository();