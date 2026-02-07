import { pool } from '../config/index.js';
import type { PoolClient, QueryResult } from 'pg';
import type { Comment, CommentData, CommentOwner, PostOwner, ReelComment, Reply, InsertComment } from '@types';
import { sError, sInfo } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';
import mediaRepository from './MediaRepository.js';

class CommentsRepository {
  async getComments(
    targetId: string,
    targetType: string,
    cursor: string | null = null,
    limit: number = 20,
    userId?: string
  ): Promise<{ comments: Comment[]; nextCursor?: string }> {
    try {
      const params: (number | string | Date | boolean)[] = [];
      let paramIndex = 1;

      // Cursor decoding
      let cursorPinned: boolean | null = null;
      let cursorLikes: number | null = null;
      let cursorCreatedAt: Date | null = null;
      let cursorId: string | null = null;

      if (cursor) {
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('ascii');
          const [pinned, likes, created, id] = decoded.split('|');
          if (pinned !== undefined && likes !== undefined && created !== undefined && id !== undefined) {
            cursorPinned = pinned === 'true';
            cursorLikes = parseInt(likes);
            cursorCreatedAt = new Date(created);
            cursorId = id;
          }
        } catch (e) {
          sError('Invalid comments cursor:', e);
        }
      }

      // Conditional user liked clause
      const userLikedClause = userId
        ? `EXISTS(
          SELECT 1 FROM likes 
          WHERE target_type = 'comment' 
          AND target_id = c.comment_id 
          AND user_id = $${paramIndex++}
        ) AS user_liked`
        : `false AS user_liked`;

      if (userId) params.push(userId);
      params.push(targetId);
      const targetIdIdx = paramIndex++;
      params.push(targetType);
      const targetTypeIdx = paramIndex++;

      // Build cursor condition
      let cursorCondition = 'TRUE';
      if (cursorPinned !== null && cursorLikes !== null && cursorCreatedAt !== null && cursorId !== null) {
        cursorCondition = `(
          (c.is_pinned < $${paramIndex++}) OR
          (c.is_pinned = $${paramIndex - 1} AND c.likes_count < $${paramIndex++}) OR
          (c.is_pinned = $${paramIndex - 2} AND c.likes_count = $${paramIndex - 1} AND c.created_at > $${paramIndex++}) OR
          (c.is_pinned = $${paramIndex - 3} AND c.likes_count = $${paramIndex - 2} AND c.created_at = $${paramIndex - 1} AND c.comment_id < $${paramIndex++})
        )`;
        params.push(cursorPinned, cursorLikes, cursorCreatedAt, cursorId);
      }

      // Main comment query
      const query = `
      SELECT 
        c.comment_id, c.content, c.likes_count, c.replies_count, c.is_pinned,
        c.created_at, c.updated_at, c.is_edited,
        u.username, u.is_online, u.user_id, 
        up.display_name, up.is_verified,
        ${userLikedClause}
      FROM comments c
      JOIN users u ON c.user_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE c.target_id = $${targetIdIdx}::uuid
        AND c.parent_comment_id IS NULL
        AND c.target_type = $${targetTypeIdx}
        AND ${cursorCondition}
      ORDER BY c.is_pinned DESC, c.likes_count DESC, c.created_at ASC, c.comment_id DESC
      LIMIT $${paramIndex++};
    `;

      params.push(limit);

      const result = await pool.query(query, params);
      const comments = result.rows;

      // fetch replies only for comments that have replies
      const commentsWithReplies = comments.filter((c) => parseInt(String(c.replies_count)) > 0);
      if (commentsWithReplies.length > 0) {
        const commentIds = commentsWithReplies.map((c) => c.comment_id);
        const placeholders = commentIds.map((_, i) => `$${i + 1}`).join(',');

        const repliesQuery = `
        SELECT 
          c.comment_id, c.parent_comment_id, c.updated_at, c.content, 
          c.likes_count, c.created_at,
          u.username, u.is_online, u.user_id, 
          up.display_name, up.is_verified
        FROM comments c
        JOIN users u ON c.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        WHERE c.parent_comment_id IN (${placeholders})
        ORDER BY c.parent_comment_id, c.created_at ASC;
      `;

        const repliesResult: QueryResult<Reply> = await pool.query(
          repliesQuery,
          commentIds
        );
        const replies = repliesResult.rows;

        // group replies by parent_comment_id (UUID keys)
        const repliesByParent = replies.reduce<Record<string, Reply[]>>(
          (acc, reply: any) => {
            const key = reply.parent_comment_id;
            if (!acc[key]) acc[key] = [];
            if (acc[key].length < 3) acc[key].push(toCamel(reply));
            return acc;
          },
          {}
        );

        comments.forEach((comment) => {
          comment.replies = repliesByParent[comment.comment_id] || [];
        });
      } else {
        comments.forEach((comment) => {
          comment.replies = [];
        });
      }

      // Fetch user media for comments and replies
      const userIds = new Set<string>();
      comments.forEach(c => userIds.add(c.user_id));
      comments.forEach(c => c.replies?.forEach((r: any) => userIds.add(r.userId)));

      if (userIds.size > 0) {
        const userMediaMap = await mediaRepository.getUsersMedia([...userIds]);
        comments.forEach((c: any) => {
          c.user_media = userMediaMap[c.user_id] || [];
          c.replies?.forEach((r: any) => {
            r.user_media = userMediaMap[r.userId] || [];
          });
        });
      }

      let nextCursor: string | undefined;
      if (comments.length === limit) {
        const lastComment = comments[comments.length - 1];
        nextCursor = Buffer.from(`${lastComment.is_pinned}|${lastComment.likes_count}|${lastComment.created_at.toISOString()}|${lastComment.comment_id}`).toString('base64');
      }

      return {
        comments: toCamel(comments) as Comment[],
        ...(nextCursor ? { nextCursor } : {})
      };
    } catch (error) {
      sError("Error in getComments:", error);
      throw error;
    }
  }

  async getCommentReplies(
    commentId: string,
    cursor: string | null = null,
    limit: number = 20,
    userId?: string
  ): Promise<{ replies: Reply[]; nextCursor?: string }> {
    try {
      const params: (number | string | Date)[] = [];
      let paramIndex = 1;

      // Cursor decoding
      let cursorLikes: number | null = null;
      let cursorCreatedAt: Date | null = null;
      let cursorId: string | null = null;

      if (cursor) {
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('ascii');
          const [likes, created, id] = decoded.split('|');
          if (likes !== undefined && created !== undefined && id !== undefined) {
            cursorLikes = parseInt(likes);
            cursorCreatedAt = new Date(created);
            cursorId = id;
          }
        } catch (e) {
          sError('Invalid comment replies cursor:', e);
        }
      }

      // handle conditional user_liked clause
      const userLikedClause = userId
        ? `EXISTS(
            SELECT 1 FROM likes 
            WHERE target_type = 'comment' 
              AND target_id = c.comment_id 
              AND user_id = $${paramIndex++}
          ) AS user_liked`
        : `false AS user_liked`;

      if (userId) params.push(userId);

      const commentIdIdx = paramIndex++;
      params.push(commentId);

      // Build cursor condition
      let cursorCondition = 'TRUE';
      if (cursorLikes !== null && cursorCreatedAt !== null && cursorId !== null) {
        cursorCondition = `(
          (c.likes_count < $${paramIndex++}) OR
          (c.likes_count = $${paramIndex - 1} AND c.created_at > $${paramIndex++}) OR
          (c.likes_count = $${paramIndex - 2} AND c.created_at = $${paramIndex - 1} AND c.comment_id < $${paramIndex++})
        )`;
        params.push(cursorLikes, cursorCreatedAt, cursorId);
      }

      const query = `
        SELECT 
          c.comment_id, c.content, c.likes_count, c.parent_comment_id,
          c.created_at, c.updated_at, c.is_edited,
          u.username, u.user_id, 
          up.display_name, up.is_verified,
          ${userLikedClause}
        FROM comments c
        JOIN users u ON c.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        WHERE c.parent_comment_id = $${commentIdIdx}
          AND ${cursorCondition}
        ORDER BY c.likes_count DESC, c.created_at ASC, c.comment_id DESC
        LIMIT $${paramIndex++};
      `;

      params.push(limit);

      const result = await pool.query(query, params);
      const replies = result.rows;

      if (replies.length > 0) {
        const userIds = [...new Set<string>(replies.map(r => r.user_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);
        replies.forEach(r => {
          (r as any).user_media = userMediaMap[r.user_id] || [];
        });
      }

      let nextCursor: string | undefined;
      if (replies.length === limit) {
        const lastReply = replies[replies.length - 1];
        nextCursor = Buffer.from(`${lastReply.likes_count}|${lastReply.created_at.toISOString()}|${lastReply.comment_id}`).toString('base64');
      }

      return {
        replies: toCamel(replies) as Reply[],
        ...(nextCursor ? { nextCursor } : {})
      };
    } catch (error) {
      sError('Error in getCommentReplies:', error);
      throw error;
    }
  }

  async verifyPostExists(postId: number): Promise<PostOwner | undefined> {
    const result: QueryResult<PostOwner> = await pool.query(
      'SELECT user_id FROM posts WHERE post_id = $1 AND is_archived = false',
      [postId]
    );
    return toCamel(result.rows[0]);
  }

  async verifyParentComment(
    parentCommentId: number,
    postId: number
  ): Promise<{ comment_id: number } | undefined> {
    const result = await pool.query(
      'SELECT comment_id FROM comments WHERE comment_id = $1 AND target_id = $2',
      [parentCommentId, postId]
    );
    return toCamel(result.rows[0]);
  }

  async insertComment({
    postId,
    userId,
    parentCommentId,
    content,
    commentId,
  }: {
    postId: string;
    userId: string;
    parentCommentId?: string | null;
    content: string;
    commentId?: string;
  }): Promise<{ comment_id: string }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const query = commentId
        ? `INSERT INTO comments (comment_id, target_id, user_id, parent_comment_id, content, target_type) 
           VALUES ($1, $2, $3, $4, $5, 'post') RETURNING comment_id`
        : `INSERT INTO comments (target_id, user_id, parent_comment_id, content, target_type) 
           VALUES ($1, $2, $3, $4, 'post') RETURNING comment_id`;

      const params = commentId
        ? [commentId, postId, userId, parentCommentId || null, content]
        : [postId, userId, parentCommentId || null, content];

      const result = await client.query(query, params);
      const newCommentId = result.rows[0].comment_id;

      if (parentCommentId) {
        await client.query(
          'UPDATE comments SET replies_count = replies_count + 1 WHERE comment_id = $1',
          [parentCommentId]
        );
      } else {
        await client.query(
          'UPDATE posts SET comments_count = comments_count + 1 WHERE post_id = $1',
          [postId]
        );
      }

      await client.query('COMMIT');
      return toCamel({ comment_id: newCommentId });
    } catch (e) {
      await client.query('ROLLBACK');
      sError('Error in insertComment:', e);
      throw e;
    } finally {
      client.release();
    }
  }

  async incrementReplyCount(parentCommentId: number): Promise<void> {
    await pool.query(
      'UPDATE comments SET replies_count = replies_count + 1 WHERE comment_id = $1',
      [parentCommentId]
    );
  }

  async getCommentOwner(parentCommentId: number | string): Promise<CommentOwner | undefined> {
    const result: QueryResult<CommentOwner> = await pool.query(
      'SELECT user_id FROM comments WHERE comment_id = $1',
      [parentCommentId]
    );
    return toCamel(result.rows[0]);
  }

  async insertReelComment(
    userId: string,
    reelId: string,
    commentText: string,
    parentId: string | null = null,
    commentId?: string
  ): Promise<ReelComment> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertQuery = commentId
        ? `INSERT INTO comments (comment_id, target_id, user_id, parent_comment_id, content, target_type)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING comment_id`
        : `INSERT INTO comments (target_id, user_id, parent_comment_id, content, target_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING comment_id`;

      const insertParams = commentId
        ? [commentId, reelId, userId, parentId, commentText, 'reel']
        : [reelId, userId, parentId, commentText, 'reel'];

      const insertResult = await client.query(insertQuery, insertParams);

      const insertedCommentId = insertResult.rows[0]?.comment_id;
      if (!insertedCommentId) throw new Error("Failed to create comment");

      await client.query(
        `UPDATE reels SET comments_count = comments_count + 1 WHERE reel_id = $1`,
        [reelId]
      );

      const result: QueryResult<ReelComment> = await client.query(
        `SELECT c.*, u.username
       FROM comments c
       INNER JOIN user_profiles u ON c.user_id = u.user_id
       WHERE c.comment_id = $1`,
        [insertedCommentId]
      );

      const comment = result.rows[0];
      if (!comment) throw new Error("Comment not found after insert");

      await client.query("COMMIT");

      // Fetch user media
      const userMediaMap = await mediaRepository.getUsersMedia([comment.userId]);
      (comment as any).user_media = userMediaMap[comment.userId] || [];

      return toCamel(comment);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteReelComment(
    userId: string,
    commentId: string,
    isAdmin: boolean = false
  ): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get comment to check ownership and get reel_id
      const commentResult = await client.query(
        `SELECT target_id, user_id FROM comments WHERE comment_id = $1`,
        [commentId]
      );

      if (commentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const comment = commentResult.rows[0];

      // Check authorization
      if (!isAdmin && comment.user_id !== userId) {
        throw new Error('Unauthorized to delete this comment');
      }

      // Delete comment
      await client.query(`DELETE FROM comments WHERE comment_id = $1`, [
        commentId,
      ]);

      // Update comments count
      await client.query(
        `UPDATE reels SET comments_count = GREATEST(comments_count - 1, 0) WHERE  target_id = $1`,
        [comment.target_id]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCommentById(commentId: string): Promise<CommentData | undefined> {
    const result: QueryResult<CommentData> = await pool.query(
      'SELECT * FROM comments WHERE comment_id = $1',
      [commentId]
    );
    return toCamel(result.rows[0]);
  }

  async updateCommentContent(commentId: string, content: string): Promise<void> {
    await pool.query(
      `UPDATE comments 
       SET content = $1, is_edited = true, updated_at = CURRENT_TIMESTAMP 
       WHERE comment_id = $2`,
      [content.trim(), commentId]
    );
  }

  async deleteComment(commentId: string): Promise<void> {
    await pool.query('DELETE FROM comments WHERE comment_id = $1', [commentId]);
  }

  async deleteReplies(parentCommentId: string): Promise<void> {
    await pool.query('DELETE FROM comments WHERE parent_comment_id = $1', [
      parentCommentId,
    ]);
  }

  async decrementReplyCount(parentCommentId: string): Promise<void> {
    await pool.query(
      'UPDATE comments SET replies_count = GREATEST(replies_count - 1, 0) WHERE comment_id = $1',
      [parentCommentId]
    );
  }

  async countReplies(commentId: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*)::int as count FROM comments WHERE parent_comment_id = $1',
      [commentId]
    );
    return toCamel(result.rows[0].count);
  }

  async bulkInsertPostComments(comments: InsertComment[]): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const values: string[] = [];
      const params: (number | string | Date | null)[] = [];

      comments.forEach((comment, i) => {
        const idx = i * 7; // 7 columns: user_id, target_id, content, created_at, updated_at, parent_comment_id, comment_id
        values.push(
          `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, 'post')`
        );
        params.push(
          comment.userId,
          comment.targetId,
          comment.content,
          comment.createdAt,
          comment.updatedAt || comment.createdAt,
          comment.parentCommentId || null,
          comment.commentId || null
        );
      });

      const insertResult = await client.query(
        `INSERT INTO comments (user_id, target_id, content, created_at, updated_at, parent_comment_id, comment_id, target_type)
       VALUES ${values.join(',')}
       RETURNING comment_id
    `,
        params
      );

      // Group increments by post
      const postIncrements = comments.filter(c => !c.parentCommentId).reduce((acc, c) => {
        const tid = String(c.targetId);
        acc[tid] = (acc[tid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [postId, count] of Object.entries(postIncrements)) {
        await client.query(
          'UPDATE posts SET comments_count = comments_count + $1 WHERE post_id = $2',
          [count, postId]
        );
      }

      // Group replies by parent
      const parentIncrements = comments.filter(c => c.parentCommentId).reduce((acc, c) => {
        const pid = String(c.parentCommentId);
        acc[pid] = (acc[pid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [parentId, count] of Object.entries(parentIncrements)) {
        await client.query(
          'UPDATE comments SET replies_count = replies_count + $1 WHERE comment_id = $2',
          [count, parentId]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      sError('Error in bulkInsertPostComments:', err);
      return false;
    } finally {
      client.release();
    }
  }
  async bulkDeletePostComments(postId: number): Promise<Boolean> {
    try {
      await pool.query('DELETE FROM comments WHERE target_id = $1', [postId]);
      return true
    }
    catch (err) {
      sError(err)
      return false
    }

  }
  async bulkInsertReelComments(comments: InsertComment[]): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const values: string[] = [];
      const params: (number | string | Date | null)[] = [];

      comments.forEach((comment, i) => {
        const idx = i * 7; // 7 columns
        values.push(
          `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, 'reel')`
        );
        params.push(
          comment.userId,
          comment.targetId,
          comment.content,
          comment.createdAt,
          comment.updatedAt || comment.createdAt,
          comment.parentCommentId || null,
          comment.commentId || null
        );
      });

      const insertResult = await client.query(
        `INSERT INTO comments (user_id, target_id, content, created_at, updated_at, parent_comment_id, comment_id, target_type)
       VALUES ${values.join(',')}
       RETURNING comment_id
    `,
        params
      );

      // Group increments by reel
      const reelIncrements = comments.filter(c => !c.parentCommentId).reduce((acc, c) => {
        const tid = String(c.targetId);
        acc[tid] = (acc[tid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [reelId, count] of Object.entries(reelIncrements)) {
        await client.query(
          'UPDATE reels SET comments_count = comments_count + $1 WHERE reel_id = $2',
          [count, reelId]
        );
      }

      // Group replies by parent
      const parentIncrements = comments.filter(c => c.parentCommentId).reduce((acc, c) => {
        const pid = String(c.parentCommentId);
        acc[pid] = (acc[pid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [parentId, count] of Object.entries(parentIncrements)) {
        await client.query(
          'UPDATE comments SET replies_count = replies_count + $1 WHERE comment_id = $2',
          [count, parentId]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      sError('Error in bulkInsertReelComments:', err);
      return false;
    } finally {
      client.release();
    }
  }

  async bulkDeleteReelComments(reelId: number): Promise<Boolean> {
    try {
      await pool.query('DELETE FROM comments WHERE target_id = $1', [reelId]);
      return true
    }
    catch (err) {
      sError(err)
      return false
    }

  }

  async bulkInsertStoryComments(comments: InsertComment[]): Promise<boolean> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const values: string[] = [];
      const params: (number | string | Date | null)[] = [];

      comments.forEach((comment, i) => {
        const idx = i * 7; // 7 columns
        values.push(
          `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, 'story')`
        );
        params.push(
          comment.userId,
          comment.targetId,
          comment.content,
          comment.createdAt,
          comment.updatedAt || comment.createdAt,
          comment.parentCommentId || null,
          comment.commentId || null
        );
      });

      const insertResult = await client.query(
        `INSERT INTO comments (user_id, target_id, content, created_at, updated_at, parent_comment_id, comment_id, target_type)
       VALUES ${values.join(',')}
       RETURNING comment_id
    `,
        params
      );

      // Group increments by story
      const storyIncrements = comments.filter(c => !c.parentCommentId).reduce((acc, c) => {
        const tid = String(c.targetId);
        acc[tid] = (acc[tid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [storyId, count] of Object.entries(storyIncrements)) {
        await client.query(
          'UPDATE stories SET comments_count = comments_count + $1 WHERE story_id = $2',
          [count, storyId]
        );
      }

      // Group replies by parent
      const parentIncrements = comments.filter(c => c.parentCommentId).reduce((acc, c) => {
        const pid = String(c.parentCommentId);
        acc[pid] = (acc[pid] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [parentId, count] of Object.entries(parentIncrements)) {
        await client.query(
          'UPDATE comments SET replies_count = replies_count + $1 WHERE comment_id = $2',
          [count, parentId]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      sError('Error in bulkInsertStoryComments:', err);
      return false;
    } finally {
      client.release();
    }
  }

  async bulkDeleteStoryComments(storyId: string): Promise<Boolean> {
    try {
      await pool.query('DELETE FROM comments WHERE target_id = $1 AND target_type = \'story\'', [storyId]);
      return true;
    } catch (err) {
      sError('Error in bulkDeleteStoryComments:', err);
      return false;
    }
  }


}



export default new CommentsRepository();