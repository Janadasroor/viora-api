
// repositories/ReelRepository.ts
import { GET_USER_MEDIA_QUERY } from "../queries/media.queries.js";
import { pool } from "../config/pg.config.js";
import type { Reel, ReelWithUser, ReelView } from "@types";
import type { PoolClient } from "pg";
import { sDebug, sError } from "sk-logger";
import { toCamel } from "@/utils/toCamel.js";
import mediaRepository from "./MediaRepository.js";

class ReelRepository {
  // ============================================
  // REEL FUNCTIONS
  // ============================================

  /**
   * Get all reels by a specific user
   * @param userId - User ID to fetch reels for
   * @param currentUserId - Current user ID (optional, for like status)
   * @returns List of reels with media and variants
   */
  async getReelsByUser(userId: string, currentUserId?: string): Promise<ReelWithUser[]> {
    try {
      const result = await pool.query(
        `SELECT r.reel_id, r.user_id, r.caption, r.audio_url, r.status, 
                r.likes_count::text, r.comments_count::text, r.shares_count::text, r.views_count::text,
                r.trending_score, r.created_at, r.updated_at, 
                up.username, up.display_name, up.is_verified, up.bio,
                up.followers_count::text, up.following_count::text
         ${currentUserId ? `, EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = r.reel_id AND user_id = $2) as is_liked, EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = r.user_id) as is_following` : ', false as is_liked, false as is_following'}
         FROM reels r
         INNER JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.user_id = $1
           AND r.status = 'published'
         ORDER BY r.created_at DESC`,
        currentUserId ? [userId, currentUserId] : [userId]
      );
      const reels = result.rows;

      if (reels.length === 0) {
        return [];
      }

      const reelIds = reels.map(r => r.reel_id);
      const reelMediaMap = await mediaRepository.getReelsMedia(reelIds);

      const userIds = [...new Set(reels.map(r => r.user_id))];
      const userMediaMap = await mediaRepository.getUsersMedia(userIds);

      reels.forEach(reel => {
        reel.media = reelMediaMap[reel.reel_id] || [];
        reel.user_media = userMediaMap[reel.user_id] || [];
      });

      return toCamel(reels);
    } catch (error) {
      sError('Error in getReelsByUser:', error);
      throw error;
    }
  }

  /**
   * Get a single reel by ID
   * @param reelId - Reel ID (UUID)
   * @param currentUserId - Current user ID (optional, for like status)
   * @returns Reel with media and user info
   */
  async getReelById(reelId: string, currentUserId?: string): Promise<ReelWithUser | null> {
    try {
      const result = await pool.query(
        `SELECT r.reel_id, r.user_id, r.caption, r.audio_url, r.status, 
                r.likes_count::text, r.comments_count::text, r.shares_count::text, r.views_count::text,
                r.trending_score, r.created_at, r.updated_at, 
                up.username, up.display_name, up.is_verified, up.bio,
                up.followers_count::text, up.following_count::text
         ${currentUserId ? `, EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = r.reel_id AND user_id = $2) as is_liked, EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = r.user_id) as is_following` : ', false as is_liked, false as is_following'}
         FROM reels r
         INNER JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.reel_id = $1
           AND r.status = 'published'`,
        currentUserId ? [reelId, currentUserId] : [reelId]
      );
      const reel = result.rows[0];

      if (!reel) {
        return null;
      }

      // Fetch reel media using centralized repository
      const reelMediaMap = await mediaRepository.getReelsMedia([reelId]);
      reel.media = reelMediaMap[reelId] || [];

      // Fetch user media (profile picture)
      const userMediaMap = await mediaRepository.getUsersMedia([reel.user_id]);
      reel.user_media = userMediaMap[reel.user_id] || [];

      return toCamel(reel);
    } catch (error) {
      sError('Error in getReelById:', error);
      throw error;
    }
  }

  /**
   * Get personalized reel feed (trending + following)
   * @param page - Page number
   * @param limit - Number of reels to fetch
   * @param userId - Current user ID
   * @returns List of reels
   */
  async getReelFeed(
    { cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }
  ): Promise<{ reels: ReelWithUser[], nextCursor?: string }> {
    try {
      let cursorScore: number | null = null;
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;

      if (cursor) {
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('ascii');
          const [scoreStr, dateStr, idStr] = decoded.split('|');
          if (scoreStr && dateStr && idStr) {
            cursorScore = parseFloat(scoreStr);
            cursorDate = new Date(dateStr);
            cursorId = idStr;
          }
        } catch (e) {
          sError('Invalid reels cursor:', e);
        }
      }

      let query = `
        SELECT DISTINCT r.reel_id, r.user_id, r.caption, r.audio_url, r.status, 
               r.likes_count::text, r.comments_count::text, r.shares_count::text, r.views_count::text,
               r.trending_score, r.created_at, r.updated_at, 
               up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text,
               EXISTS(SELECT 1 FROM reel_likes WHERE reel_id = r.reel_id AND user_id = $1) as is_liked,
               EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = r.user_id) as is_following
        FROM reels r
        INNER JOIN user_profiles up ON r.user_id = up.user_id
        LEFT JOIN follows uf ON r.user_id = uf.following_id AND uf.follower_id = $1
        WHERE r.status = 'published'
          AND r.user_id != $1
          AND (uf.follower_id IS NOT NULL OR r.trending_score > 10)
      `;

      const params: any[] = [userId];
      let paramIndex = 2;

      if (cursorScore !== null && cursorDate && cursorId) {
        query += ` AND (
          r.trending_score < $${paramIndex} 
          OR (r.trending_score = $${paramIndex} AND r.created_at < $${paramIndex + 1})
          OR (r.trending_score = $${paramIndex} AND r.created_at = $${paramIndex + 1} AND r.reel_id < $${paramIndex + 2})
        )`;
        params.push(cursorScore, cursorDate, cursorId);
        paramIndex += 3;
      }

      query += ` ORDER BY r.trending_score DESC, r.created_at DESC, r.reel_id DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);
      const reels = result.rows;

      if (reels.length > 0) {
        const reelIds = reels.map(r => r.reel_id);
        const reelMediaMap = await mediaRepository.getReelsMedia(reelIds);

        const userIds = [...new Set(reels.map(r => r.user_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        reels.forEach(reel => {
          reel.media = reelMediaMap[reel.reel_id] || [];
          reel.user_media = userMediaMap[reel.user_id] || [];
        });
      }

      let nextCursor: string | undefined;
      if (reels.length === parseInt(String(limit), 10)) {
        const lastReel = reels[reels.length - 1];
        nextCursor = Buffer.from(`${lastReel.trending_score}|${lastReel.created_at.toISOString()}|${lastReel.reel_id}`).toString('base64');
      }

      const response: { reels: ReelWithUser[], nextCursor?: string } = {
        reels: toCamel(reels)
      };
      if (nextCursor) response.nextCursor = nextCursor;

      return response;
    } catch (error) {
      sError('Error in getReelFeed:', error);
      throw error;
    }
  }

  /**
   * Create a new reel
   * @param userId - User ID
   * @param caption - Reel caption
   * @param mediaUrl - Video URL
   * @param audioUrl - Audio URL (optional)
   * @returns Created reel
   */
  async createReel(
    userId: string,
    caption: string,
    audioUrl: string | null = null
  ): Promise<ReelWithUser> {
    try {
      const insertResult = await pool.query(
        `INSERT INTO reels (user_id, caption, audio_url, status)
         VALUES ($1, $2, $3, $4)
         RETURNING reel_id`,
        [userId, caption, audioUrl, "processing"]
      );
      if (!insertResult.rows[0]) throw new Error("Failed to create reel");
      const reelId = insertResult.rows[0].reel_id;

      const result = await pool.query(
        `SELECT r.reel_id, r.user_id, r.caption, r.audio_url, r.status, 
                r.likes_count::text, r.comments_count::text, r.shares_count::text, r.views_count::text,
                r.trending_score, r.created_at, r.updated_at, 
                up.username, up.display_name, up.is_verified, up.bio,
                up.followers_count::text, up.following_count::text
         FROM reels r
         INNER JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.reel_id = $1`,
        [reelId]
      );
      const reel = result.rows[0];
      if (!reel) throw new Error("Reel not found");

      const userMediaMap = await mediaRepository.getUsersMedia([reel.user_id]);
      reel.user_media = userMediaMap[reel.user_id] || [];

      return toCamel(reel);
    } catch (error) {
      sError('Error in createReel:', error);
      throw error;
    }
  }

  /**
   * Delete a reel (only owner can delete)
   * @param userId - User ID
   * @param reelId - Reel ID (UUID)
   * @returns Success status
   */
  async deleteReel(userId: string, reelId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `DELETE FROM reels WHERE reel_id = $1 AND user_id = $2`,
        [reelId, userId]
      );

      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      sError(error);
      throw error;
    }
  }

  /**
   * Update reel status
   */
  async updateReelStatus(reelId: string, status: string): Promise<void> {
    await pool.query(
      'UPDATE reels SET status = $1, updated_at = NOW() WHERE reel_id = $2',
      [status, reelId]
    );
  }

  /**
   * Modify reel caption (only owner can modify)
   * @param userId - User ID
   * @param reelId - Reel ID (UUID)
   * @param caption - New caption
   * @returns Updated reel
   */
  async modifyReel(
    userId: string,
    reelId: string,
    caption: string
  ): Promise<ReelWithUser> {
    try {
      const updateResult = await pool.query(
        `UPDATE reels SET caption = $1 WHERE reel_id = $2 AND user_id = $3`,
        [caption, reelId, userId]
      );

      if (updateResult.rowCount === 0) {
        throw new Error("Reel not found or unauthorized");
      }

      const result = await pool.query(
        `SELECT r.reel_id, r.user_id, r.caption, r.audio_url, r.status, 
                r.likes_count::text, r.comments_count::text, r.shares_count::text, r.views_count::text,
                r.trending_score, r.created_at, r.updated_at, 
                up.username, up.display_name, up.is_verified, up.bio,
                up.followers_count::text, up.following_count::text
         FROM reels r
         INNER JOIN user_profiles up ON r.user_id = up.user_id
         WHERE r.reel_id = $1`,
        [reelId]
      );
      const reel = result.rows[0];
      if (!reel) throw new Error(`Reel with id ${reelId} not found after update`);

      // Fetch user media
      const userMediaMap = await mediaRepository.getUsersMedia([reel.user_id]);
      reel.user_media = userMediaMap[reel.user_id] || [];

      return toCamel(reel);

    } catch (error) {
      sError(error);
      throw error;
    }
  }

  /**
   * Get reel owner
   * @param reelId - Reel ID (UUID)
   * @returns Owner user ID
   */
  async getReelOwner(reelId: string): Promise<{ userId: string } | null> {
    const result = await pool.query(
      'SELECT user_id FROM reels WHERE reel_id = $1',
      [reelId]
    );

    return toCamel(result.rows[0]) || null;
  }

  async insertReelMedia(reelId: string, mediaIds: string[]): Promise<void> {
    if (!mediaIds || mediaIds.length === 0) return;

    // generate placeholders: ($1, $2, $3), ($1, $4, $5), ...
    const values = mediaIds
      .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
      .join(', ');

    // build params: first postId, then mediaId and order pairs
    const params: any[] = [reelId];
    mediaIds.forEach((mediaId, index) => {
      params.push(mediaId, index + 1);
    });

    const query = `
    INSERT INTO reel_media (reel_id, media_id, media_order)
    VALUES ${values}
  `;

    await pool.query(query, params);
  }
}

export default new ReelRepository();