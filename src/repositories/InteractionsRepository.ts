import { sDebug, sError } from "sk-logger";
import { pool } from "../config/pg.config.js";
import { toCamel } from "@/utils/toCamel.js";


class IntractionsRepository {
  constructor() {
  }


  async getPostOwner(postId: string): Promise<{ user_id: string }[]> {
    const result = await pool.query(
      `SELECT user_id FROM posts WHERE post_id = $1`,
      [postId]
    );
    return toCamel(result.rows);
  }

  async checkPostLiked(postId: string, userId: string) {
    const result = await pool.query(
      `SELECT reaction_type 
       FROM likes 
       WHERE user_id = $1 AND target_type = 'post' AND target_id = $2`,
      [userId, postId]
    );
    return result.rows.length > 0;
  }

  async likeComment(commentId: string, userId: string, reactionType: string = "like") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
         VALUES ($1, 'comment', $2, $3)
         ON CONFLICT (user_id, target_type, target_id)
         DO UPDATE SET reaction_type = EXCLUDED.reaction_type`,
        [userId, commentId, reactionType]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async unlikeComment(commentId: string, userId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM likes 
         WHERE user_id = $1 AND target_type = 'comment' AND target_id = $2`,
        [userId, commentId]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async insertPostLike(postId: string, userId: string, reactionType: string = "like") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
         VALUES ($1, 'post', $2, $3)
         ON CONFLICT (user_id, target_type, target_id)
         DO UPDATE SET reaction_type = EXCLUDED.reaction_type`,
        [userId, postId, reactionType]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkInsertPostLikes(likes: Array<{ userId: string; postId: string; reactionType: string }>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const values: string[] = [];
      const params: Array<string> = [];

      likes.forEach((like, i) => {
        const idx = i * 3;
        values.push(`($${idx + 1}, 'post', $${idx + 2}, $${idx + 3})`);
        params.push(like.userId, like.postId, like.reactionType);
      });

      // Insert likes and detect which ones are new
      const insertRes = await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
       VALUES ${values.join(',')}
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET reaction_type = EXCLUDED.reaction_type
       RETURNING (xmax = 0) as is_new, target_id;
      `,
        params
      );

      // Count new likes per post
      const postId = likes[0]?.postId;
      const increment = insertRes.rows.filter(r => r.is_new).length;
      sDebug("increment", increment);
      if (increment > 0) {
        await client.query(
          `
        UPDATE posts
        SET likes_count = likes_count + $1
        WHERE post_id = $2
        RETURNING likes_count;
        `,
          [increment, postId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkInsertReelLikes(likes: Array<{ userId: string; reelId: string; createdAt: string; reactionType: string }>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const values: string[] = [];
      const params: Array<string> = [];

      likes.forEach((like, i) => {
        const idx = i * 3;
        values.push(`($${idx + 1}, 'reel', $${idx + 2}, $${idx + 3})`);
        params.push(like.userId, like.reelId, like.reactionType);
      });

      // Insert likes and detect which ones are new
      const insertRes = await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
       VALUES ${values.join(',')}
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET reaction_type = EXCLUDED.reaction_type
       RETURNING (xmax = 0) as is_new, target_id;
      `,
        params
      );

      // Count new likes per post
      const reelId = likes[0]?.reelId;
      const increment = insertRes.rows.filter(r => r.is_new).length;
      sDebug("increment", increment);
      if (increment > 0) {
        await client.query(
          `
        UPDATE reels
        SET likes_count = likes_count + $1
        WHERE reel_id = $2
        RETURNING likes_count;
        `,
          [increment, reelId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkDeleteReelLikes(userIds: Array<string>, reelId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete likes
      const deleteResult = await client.query(
        `DELETE FROM reel_likes 
         WHERE reel_id = $1 AND user_id = ANY($2)
         RETURNING user_id`,
        [reelId, userIds]
      );

      const deletedCount = deleteResult.rowCount || 0;

      if (deletedCount > 0) {
        await client.query(
          `UPDATE reels
           SET likes_count = GREATEST(likes_count - $1, 0)
           WHERE reel_id = $2`,
          [deletedCount, reelId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkInsertStoryLikes(likes: Array<{ userId: string; storyId: string; reactionType: string }>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const values: string[] = [];
      const params: Array<string> = [];

      likes.forEach((like, i) => {
        const idx = i * 3;
        values.push(`($${idx + 1}, 'story', $${idx + 2}, $${idx + 3})`);
        params.push(like.userId, like.storyId, like.reactionType);
      });

      // Insert likes and detect which ones are new
      const insertRes = await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
         VALUES ${values.join(',')}
         ON CONFLICT (user_id, target_type, target_id)
         DO UPDATE SET reaction_type = EXCLUDED.reaction_type
         RETURNING (xmax = 0) as is_new, target_id;
        `,
        params
      );

      // Update likes_count in stories table
      const storyId = likes[0]?.storyId;
      const increment = insertRes.rows.filter(r => r.is_new).length;
      if (increment > 0) {
        await client.query(
          `UPDATE stories SET likes_count = likes_count + $1 WHERE story_id = $2`,
          [increment, storyId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async likePost(postId: string, userId: string, reactionType: string = "like") {
    return await this.insertPostLike(postId, userId, reactionType);
  }

  async likeReel(userId: string, reelId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO reel_likes (reel_id, user_id) 
         VALUES ($1, $2) 
         ON CONFLICT (reel_id, user_id) DO NOTHING`,
        [reelId, userId]
      );

      await client.query(
        `UPDATE reels SET likes_count = likes_count + 1 WHERE reel_id = $1`,
        [reelId]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  async unlikeReel(userId: string, reelId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `DELETE FROM reel_likes WHERE reel_id = $1 AND user_id = $2`,
        [reelId, userId]
      );

      if (result.rowCount || 0 > 0) {
        await client.query(
          `UPDATE reels SET likes_count = GREATEST(likes_count - 1, 0) WHERE reel_id = $1`,
          [reelId]
        );
      }

      await client.query("COMMIT");
      return result.rowCount || 0 > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async unlikePost(postId: string, userId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM likes 
         WHERE user_id = $1 AND target_type = 'post' AND target_id = $2`,
        [userId, postId]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async likeStory(userId: string, storyId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type) 
         VALUES ($1, 'story', $2, 'like') 
         ON CONFLICT (user_id, target_type, target_id) 
         DO UPDATE SET reaction_type = EXCLUDED.reaction_type`,
        [userId, storyId]
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async unlikeStory(userId: string, storyId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const result = await client.query(
        `DELETE FROM likes 
         WHERE user_id = $1 AND target_type = 'story' AND target_id = $2`,
        [userId, storyId]
      );

      await client.query("COMMIT");
      return result.rowCount || 0 > 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async sharePost(postId: string, userId: string) {
    const client = await pool.connect();
    try {
      const postOwnerResult = await client.query(
        `SELECT user_id FROM posts WHERE post_id = $1`,
        [postId]
      );
      if (postOwnerResult.rows.length === 0) {
        throw new Error("Post not found");
      }

      await client.query(
        `INSERT INTO post_shares (user_id, post_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, postId]
      );

      return true;
    } catch (error) {
      sError("Error in sharePost:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async bulkInsertCommentLikes(likes: Array<{ userId: string; commentId: string; reactionType: string }>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const values: string[] = [];
      const params: Array<string> = [];

      likes.forEach((like, i) => {
        const idx = i * 3;
        values.push(`($${idx + 1}, 'comment', $${idx + 2}, $${idx + 3})`);
        params.push(like.userId, like.commentId, like.reactionType);
      });

      // Insert likes and detect which ones are new
      const insertRes = await client.query(
        `INSERT INTO likes (user_id, target_type, target_id, reaction_type)
       VALUES ${values.join(',')}
       ON CONFLICT (user_id, target_type, target_id)
       DO UPDATE SET reaction_type = EXCLUDED.reaction_type
       RETURNING (xmax = 0) as is_new, target_id;
      `,
        params
      );

      // Count new likes per comment
      const commentId = likes[0]?.commentId;
      const increment = insertRes.rows.filter(r => r.is_new).length;

      if (increment > 0) {
        await client.query(
          `
        UPDATE comments
        SET likes_count = likes_count + $1
        WHERE comment_id = $2
        RETURNING likes_count;
        `,
          [increment, commentId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkDeleteCommentLikes(userIds: Array<string>, commentId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete likes
      const deleteResult = await client.query(
        `DELETE FROM likes 
         WHERE target_type = 'comment' AND target_id = $1 AND user_id = ANY($2)
         RETURNING user_id`,
        [commentId, userIds]
      );

      const deletedCount = deleteResult.rowCount || 0;

      if (deletedCount > 0) {
        await client.query(
          `UPDATE comments
           SET likes_count = GREATEST(likes_count - $1, 0)
           WHERE comment_id = $2`,
          [deletedCount, commentId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  async bulkDeletePostLikes(userIds: Array<string>, postId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete likes
      const deleteResult = await client.query(
        `DELETE FROM likes 
         WHERE target_type = 'post' AND target_id = $1 AND user_id = ANY($2)
         RETURNING user_id`,
        [postId, userIds]
      );

      const deletedCount = deleteResult.rowCount || 0;

      if (deletedCount > 0) {
        await client.query(
          `UPDATE posts
           SET likes_count = GREATEST(likes_count - $1, 0)
           WHERE post_id = $2`,
          [deletedCount, postId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async bulkDeleteStoryLikes(userIds: Array<string>, storyId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Delete likes
      const deleteResult = await client.query(
        `DELETE FROM likes 
         WHERE target_type = 'story' AND target_id = $1 AND user_id = ANY($2)`,
        [storyId, userIds]
      );

      const deletedCount = deleteResult.rowCount || 0;

      if (deletedCount > 0) {
        await client.query(
          `UPDATE stories
           SET likes_count = GREATEST(likes_count - $1, 0)
           WHERE story_id = $2`,
          [deletedCount, storyId]
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

const intractionsRepository = new IntractionsRepository();
export default intractionsRepository;


