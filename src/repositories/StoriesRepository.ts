
import { pool } from "../config/pg.config.js";
import type { PaginatedStories, Story, PaginatedViews, StoryView, StoryData } from "@types";
import { sError } from "sk-logger";
import { toCamel } from "@/utils/toCamel.js";
import mediaRepository from "./MediaRepository.js";

class StoriesRepository {
  constructor() {

  }
  async getStories({ cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }): Promise<PaginatedStories> {
    try {
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
          sError('Invalid stories cursor:', e);
        }
      }

      let query = `
        SELECT s.story_id, s.user_id, s.content, s.story_type, s.visibility,
               s.stickers, s.music_id, s.text_overlay, s.expires_at,
               s.views_count::text, s.likes_count::text, s.comments_count::text, s.created_at, 
               up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text,
               EXISTS(SELECT 1 FROM likes WHERE target_type = 'story' AND target_id = s.story_id AND user_id = $1) as is_liked
        FROM stories s
        JOIN user_profiles up ON s.user_id = up.user_id 
        WHERE s.user_id = $1
          AND s.status = 'published'
          AND s.expires_at > NOW()
      `;

      const params: any[] = [userId];
      let paramIndex = 2;

      if (cursorDate && cursorId) {
        query += ` AND (s.created_at < $${paramIndex} OR (s.created_at = $${paramIndex} AND s.story_id < $${paramIndex + 1})) `;
        params.push(cursorDate, cursorId);
        paramIndex += 2;
      }

      query += ` ORDER BY s.created_at DESC, s.story_id DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);
      const stories = result.rows;

      if (stories.length > 0) {
        const storyIds = stories.map(s => s.story_id);
        const storyMediaMap = await mediaRepository.getStoriesMedia(storyIds);
        const userIds = [...new Set(stories.map(s => s.user_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        stories.forEach(story => {
          story.media = storyMediaMap[story.story_id] || [];
          story.user_media = userMediaMap[story.user_id] || [];
        });
      }

      let nextCursor: string | undefined;
      if (stories.length === parseInt(String(limit), 10)) {
        const last = stories[stories.length - 1];
        nextCursor = Buffer.from(`${last.created_at.toISOString()}|${last.story_id}`).toString('base64');
      }

      return {
        stories: toCamel(stories),
        hasMore: stories.length === parseInt(String(limit), 10),
        nextCursor
      };
    } catch (error) {
      sError("Error in getStories:", error);
      throw error;
    }
  }

  async getFollowingStories({ cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }): Promise<PaginatedStories> {
    try {
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
          sError('Invalid stories cursor:', e);
        }
      }

      let query = `
        SELECT s.story_id, s.user_id, s.content, s.story_type, s.visibility,
               s.stickers, s.music_id, s.text_overlay, s.expires_at,
               s.views_count::text, s.likes_count::text, s.comments_count::text, s.created_at,
               up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text,
               EXISTS(SELECT 1 FROM likes WHERE target_type = 'story' AND target_id = s.story_id AND user_id = $1) as is_liked,
               true as is_following
        FROM stories s
        JOIN user_profiles up ON s.user_id = up.user_id
        JOIN follows f ON f.following_id = s.user_id
        WHERE f.follower_id = $1
          AND f.status = 'accepted'
          AND s.status = 'published'
          AND s.expires_at > NOW()
      `;

      const params: any[] = [userId];
      let paramIndex = 2;

      if (cursorDate && cursorId) {
        query += ` AND (s.created_at < $${paramIndex} OR (s.created_at = $${paramIndex} AND s.story_id < $${paramIndex + 1})) `;
        params.push(cursorDate, cursorId);
        paramIndex += 2;
      }

      query += ` ORDER BY s.created_at DESC, s.story_id DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await pool.query(query, params);
      const stories = result.rows;

      if (stories.length > 0) {
        const storyIds = stories.map(s => s.story_id);
        const storyMediaMap = await mediaRepository.getStoriesMedia(storyIds);
        const userIds = [...new Set(stories.map(s => s.user_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        stories.forEach(story => {
          story.media = storyMediaMap[story.story_id] || [];
          story.user_media = userMediaMap[story.user_id] || [];
        });
      }

      let nextCursor: string | undefined;
      if (stories.length === parseInt(String(limit), 10)) {
        const last = stories[stories.length - 1];
        nextCursor = Buffer.from(`${last.created_at.toISOString()}|${last.story_id}`).toString('base64');
      }

      return {
        stories: toCamel(stories),
        hasMore: stories.length === parseInt(String(limit), 10),
        nextCursor
      };
    } catch (error) {
      sError("Error in getFollowingStories:", error);
      throw error;
    }
  }
  async insertStoryMedia(storyId: string, mediaIds: string[]): Promise<void> {
    if (!mediaIds || mediaIds.length === 0) return;

    // generate placeholders: ($1, $2, $3), ($1, $4, $5), ...
    const values = mediaIds
      .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
      .join(', ');

    // build params: first postId, then mediaId and order pairs
    const params: any[] = [storyId];
    mediaIds.forEach((mediaId, index) => {
      params.push(mediaId, index + 1);
    });

    const query = `
    INSERT INTO story_media (story_id, media_id, media_order)
    VALUES ${values}
  `;

    await pool.query(query, params);
  }
  async getStoryViews(page: number, limit: number, userId: string, storyId: string): Promise<PaginatedViews> {
    try {
      const offset = (page - 1) * parseInt(limit.toString());
      const limitNum = parseInt(limit.toString());

      // Check ownership first
      const ownerCheck = await pool.query(
        `SELECT user_id FROM stories WHERE story_id = $1 LIMIT 1`,
        [storyId]
      );

      if (!ownerCheck.rows.length) {
        throw new Error("Story not found");
      }

      if (ownerCheck.rows[0].user_id !== userId) {
        throw new Error("Forbidden: You don't own this story");
      }

      const result = await pool.query(`
        SELECT up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text,
               sv.viewer_id, sv.viewed_at, sv.story_id 
        FROM story_views sv 
        JOIN user_profiles up ON sv.viewer_id = up.user_id
        WHERE sv.story_id = $1
        ORDER BY sv.viewed_at DESC
        LIMIT $2 OFFSET $3
      `, [storyId, limitNum, offset]);

      const views = result.rows;

      if (views.length > 0) {
        const viewerIds = [...new Set(views.map(v => v.viewer_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(viewerIds);

        views.forEach(view => {
          view.user_media = userMediaMap[view.viewer_id] || [];
        });
      }

      return {
        views: toCamel(views),
        hasMore: views.length === limitNum
      };
    } catch (error) {
      sError("Error in getStoryViews:", error);
      throw error;
    }
  }

  async createStory(userId: string, storyData: StoryData): Promise<any> {
    try {
      const {
        storyType = "photo",
        content = null,
        backgroundColor = null,
        textOverlay = null,
        stickers = null,
        musicId = null,
        visibility = "public",
        status = "processing"
      } = storyData;

      // 24 hours expiration
      const result = await pool.query(
        `
        INSERT INTO stories 
          (user_id, story_type, content, background_color, text_overlay,
           stickers, music_id, visibility, views_count, expires_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NOW() + INTERVAL '24 hours', $9)
        RETURNING story_id
        `,
        [
          userId,
          storyType,
          content,
          backgroundColor,
          textOverlay ? JSON.stringify(textOverlay) : null,
          stickers ? JSON.stringify(stickers) : null,
          musicId,
          visibility,
          status
        ]
      );

      const storyId = result.rows[0].story_id;

      // Fetch back the created story with rich user info
      const story = await pool.query(
        `
        SELECT s.story_id, s.user_id, s.story_type, s.content,
               s.background_color, s.text_overlay, s.stickers, s.music_id,
               s.visibility, s.views_count::text, s.expires_at, s.created_at,
               up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text
        FROM stories s
        JOIN user_profiles up ON s.user_id = up.user_id
        WHERE s.story_id = $1
        `,
        [storyId]
      );

      const storyObj = story.rows[0];
      if (!storyObj) throw new Error("Story not found after creation");

      // Fetch user media
      const userMediaMap = await mediaRepository.getUsersMedia([userId]);
      storyObj.user_media = userMediaMap[userId] || [];

      return toCamel(storyObj);
    } catch (error) {
      sError("Error in createStory:", error);
      throw error;
    }
  }

  async deleteStory(userId: string, storyId: string): Promise<boolean> {
    try {
      // Check if story exists & belongs to the user
      const story = await pool.query(
        "SELECT story_id FROM stories WHERE story_id = $1 AND user_id = $2",
        [storyId, userId]
      );

      if (story.rows.length === 0) {
        throw new Error("Story not found or you do not have permission to delete it");
      }

      // Delete the story (cascade views if needed)
      await pool.query("DELETE FROM stories WHERE story_id = $1", [storyId]);

      // Optionally delete views (if not using ON DELETE CASCADE in schema)
      await pool.query("DELETE FROM story_views WHERE story_id = $1", [storyId]);

      return true;
    } catch (error) {
      sError("Error in deleteStory:", error);
      throw error;
    }
  }

  /**
   * Update story status
   */
  async updateStoryStatus(storyId: string, status: string): Promise<void> {
    await pool.query(
      'UPDATE stories SET status = $1 WHERE story_id = $2',
      [status, storyId]
    );
  }

  async updateStory(userId: string, storyId: string, updates: Partial<StoryData>): Promise<Story> {
    try {
      // Check ownership
      const check = await pool.query(
        "SELECT story_id FROM stories WHERE story_id = $1 AND user_id = $2",
        [storyId, userId]
      );

      if (check.rows.length === 0) {
        throw new Error("Story not found or unauthorized");
      }

      const { visibility, textOverlay, stickers } = updates;
      const params: any[] = [storyId, userId];
      const setClauses: string[] = [];
      let paramIndex = 3;

      if (visibility !== undefined) {
        setClauses.push(`visibility = $${paramIndex}`);
        params.push(visibility);
        paramIndex++;
      }

      if (textOverlay !== undefined) {
        setClauses.push(`text_overlay = $${paramIndex}`);
        params.push(JSON.stringify(textOverlay));
        paramIndex++;
      }

      if (stickers !== undefined) {
        setClauses.push(`stickers = $${paramIndex}`);
        params.push(JSON.stringify(stickers));
        paramIndex++;
      }

      if (setClauses.length === 0) {
        throw new Error("No updates provided");
      }

      const query = `
        UPDATE stories 
        SET ${setClauses.join(", ")}
        WHERE story_id = $1 AND user_id = $2
        RETURNING story_id, user_id, story_type, content, background_color, text_overlay, 
                  stickers, music_id, visibility, views_count::text, expires_at, created_at, status
      `;

      const result = await pool.query(query, params);
      const story = result.rows[0];

      // Fetch user details and media to return complete object
      const userResult = await pool.query(
        "SELECT username, display_name FROM user_profiles WHERE user_id = $1",
        [userId]
      );
      const user = userResult.rows[0];

      story.username = user.username;
      story.display_name = user.display_name;

      // Fetch user media
      const userMediaMap = await mediaRepository.getUsersMedia([userId]);
      story.user_media = userMediaMap[userId] || [];

      // Fetch story media
      const storyMediaMap = await mediaRepository.getStoriesMedia([story.story_id])
      story.media = storyMediaMap[storyId] || []

      return story;
    } catch (error) {
      sError("Error in updateStory:", error);
      throw error;
    }
  }

  async getStoryById(storyId: string, userId: string): Promise<Story | null> {
    try {
      const result = await pool.query(`
        SELECT s.story_id, s.user_id, s.content, s.story_type, s.visibility,
               s.stickers, s.music_id, s.text_overlay, s.expires_at,
               s.views_count::text, s.likes_count::text, s.comments_count::text, s.created_at,
               up.username, up.display_name, up.is_verified, up.bio,
               up.followers_count::text, up.following_count::text,
               EXISTS(SELECT 1 FROM likes WHERE target_type = 'story' AND target_id = s.story_id AND user_id = $2) as is_liked
        FROM stories s
        JOIN user_profiles up ON s.user_id = up.user_id
        WHERE s.story_id = $1
          AND s.status = 'published'
      `, [storyId, userId]);

      if (result.rows.length === 0) return null;

      const story = result.rows[0];

      const storyMediaMap = await mediaRepository.getStoriesMedia([storyId])
      const userMediaMap = await mediaRepository.getUsersMedia([story.user_id]);

      story.media = storyMediaMap[storyId] || []
      story.user_media = userMediaMap[story.user_id] || [];

      return toCamel(story);
    } catch (error) {
      sError("Error in getStoryById:", error);
      throw error;
    }
  }

  /**
   * Bulk insert story views.
   */
  async bulkInsertStoryViews(views: Array<{ storyId: string; userId: string }>): Promise<void> {
    if (!views || views.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const values = views
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(', ');

      const params: any[] = [];
      views.forEach(v => {
        params.push(v.storyId, v.userId);
      });

      // Insert views using ON CONFLICT to avoid duplicates if same user views story again
      await client.query(`
        INSERT INTO story_views (story_id, viewer_id)
        VALUES ${values}
        ON CONFLICT DO NOTHING
      `, params);

      // We don't update counts here; we'll do it in a separate sync method or trigger
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      sError("Error in bulkInsertStoryViews:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync story view counts from story_views table to stories table.
   */
  async syncStoryViewCounts(storyId: string): Promise<number> {
    try {
      const result = await pool.query(`
        UPDATE stories s
        SET views_count = (
          SELECT COUNT(*)
          FROM story_views
          WHERE story_id = $1
        )
        WHERE s.story_id = $1
        RETURNING views_count
      `, [storyId]);

      return parseInt(result.rows[0]?.views_count || '0', 10);
    } catch (error) {
      sError("Error in syncStoryViewCounts:", error);
      throw error;
    }
  }

  /**
   * Get story owner
   * @param storyId - Story ID (UUID)
   * @returns Owner user ID
   */
  async getStoryOwner(storyId: string): Promise<{ userId: string } | null> {
    const result = await pool.query(
      'SELECT user_id FROM stories WHERE story_id = $1',
      [storyId]
    );

    return toCamel(result.rows[0]) || null;
  }
}

export default new StoriesRepository();