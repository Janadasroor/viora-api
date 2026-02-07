// types/user.types.ts
import { sDebug, sError, sInfo } from "sk-logger";
import { pool } from "../config/pg.config.js";
import { GET_USER_MEDIA_QUERY } from "../queries/media.queries.js";

// repositories/UserRepository.ts
import type {
  UserWithProfile,
  UserProfile,
  ProfileUpdateData,
  UserFilters,
  Follow,
  UserProfileWithFollow,
  User,
} from "@types";
import type { PoolClient } from "pg";
import { toCamel } from "@/utils/toCamel.js";
import mediaRepository from "./MediaRepository.js";

class UserRepository {
  /**
   * Get followers for a user with pagination
   */
  async getFollowers(
    userId: string,
    page: number,
    limit: number
  ): Promise<UserProfileWithFollow[]> {
    const offset = (page - 1) * parseInt(String(limit), 10);

    const query = `
      SELECT 
        u.user_id,
        u.is_online, 
        u.username,
        u.email, 
        up.display_name,
        u.email_verified, 
        up.is_verified,
        EXISTS (
      SELECT 1 
      FROM follows f2 
      WHERE f2.follower_id = $1
        AND f2.following_id = u.user_id
        AND f2.status = 'accepted'
          ) AS is_following,
        f.created_at as followed_at
      FROM follows f
      JOIN users u ON f.follower_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE f.following_id = $1 
        AND f.status = 'accepted' 
        AND u.account_status = 'active'
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [userId, limit, offset]);
    const users = result.rows;
    const userIds = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    users.forEach(u => {
      u.media = userMediaMap[u.user_id] || [];
      u.profile_picture_url = u.media[0]?.file_path || null;
    })
    return toCamel(users);
  }

  /**
   * Get users that a user is following with pagination
   */
  async getFollowing(
    userId: string,
    page: number,
    limit: number
  ): Promise<UserProfileWithFollow[]> {
    const offset = (page - 1) * parseInt(String(limit), 10);

    const query = `
      SELECT 
        u.user_id, 
        u.username,
        u.is_online,
        u.email,
        u.email_verified, 
        up.display_name, 
        up.is_verified, 
        EXISTS (
      SELECT 1 
      FROM follows f2 
      WHERE f2.follower_id = $1
        AND f2.following_id = u.user_id
        AND f2.status = 'accepted'
          ) AS is_following,
        f.created_at as followed_at
      FROM follows f
      JOIN users u ON f.following_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE f.follower_id = $1 
        AND f.status = 'accepted' 
        AND u.account_status = 'active'
      ORDER BY f.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [userId, limit, offset]);
    const users = result.rows;
    const userIds = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    users.forEach(u => {
      u.media = userMediaMap[u.user_id] || [];
      u.profile_picture_url = u.media[0]?.file_path || null;
    })
    return toCamel(users);
  }

  /**
   * Check if username is available
   */
  async checkUsernameExists(username: string): Promise<boolean> {
    const query = "SELECT user_id FROM users WHERE username = $1";
    const result = await pool.query(query, [username]);
    return result.rows.length > 0;
  }

  /**
   * Insert user media relationship
   */
  async insertUserMedia(userId: string, mediaId: string): Promise<void> {
    await pool.query(
      `INSERT INTO user_media (user_id, media_id) VALUES ($1, $2)`,
      [userId, mediaId]
    );
  }

  /**
   * Get users by usernames
   */
  async getUsersByUsernames(usernames: string[]): Promise<User[]> {
    if (usernames.length === 0) return [];
    const query = `
      SELECT user_id, username 
      FROM users 
      WHERE username = ANY($1)
    `;
    const result = await pool.query(query, [usernames]);
    const users = result.rows;
    const userIds = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    users.forEach(u => {
      u.media = userMediaMap[u.user_id] || [];
      u.profile_picture_url = u.media[0]?.file_path || null;
    });
    return toCamel(users);
  }

  /**
   * Get users by IDs with basic profile info
   */
  async getUsersByIds(userIds: any[]): Promise<UserWithProfile[]> {
    if (!userIds || userIds.length === 0) return [];

    // Sanitize userIds: keep as string, handle potential double-quoted strings
    const sanitizedIds = userIds
      .map(id => {
        if (typeof id === 'string') {
          // Remove literal double quotes if present (e.g., ""2448"")
          return id.replace(/"/g, '');
        }
        return String(id);
      })
      .filter(id => id !== null && id !== undefined && id !== "");

    if (sanitizedIds.length === 0) return [];

    const query = `
      SELECT u.user_id, u.username, up.display_name
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.user_id = ANY($1)
    `;
    const result = await pool.query(query, [sanitizedIds]);
    const users = result.rows;
    const ids = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(ids);
    users.forEach(u => {
      u.media = userMediaMap[u.user_id] || [];
      u.profile_picture_url = u.media[0]?.file_path || null;
    });
    return toCamel(users);
  }

  // Profile picture URL is now derived from user_media table
  // No need for updateProfilePictureUrl method

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    profileData: ProfileUpdateData
  ): Promise<UserProfile> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (profileData.displayName !== undefined) {
      fields.push(`display_name = $${paramCount++}`);
      values.push(profileData.displayName);
    }
    if (profileData.bio !== undefined) {
      fields.push(`bio = $${paramCount++}`);
      values.push(profileData.bio);
    }
    if (profileData.website !== undefined) {
      fields.push(`website = $${paramCount++}`);
      values.push(profileData.website);
    }
    if (profileData.location !== undefined) {
      fields.push(`location = $${paramCount++}`);
      values.push(profileData.location);
    }
    if (profileData.isPrivate !== undefined) {
      fields.push(`is_private = $${paramCount++}`);
      values.push(profileData.isPrivate);
    }
    if (profileData.gender !== undefined) {
      fields.push(`gender = $${paramCount++}`);
      values.push(profileData.gender);
    }
    if (profileData.birthDate !== undefined) {
      fields.push(`birth_date = $${paramCount++}`);
      values.push(profileData.birthDate);
    }
    if (profileData.safeMode !== undefined) {
      fields.push(`safe_mode = $${paramCount++}`);
      values.push(profileData.safeMode);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(userId);

    const query = `
      UPDATE user_profiles 
      SET ${fields.join(", ")} 
      WHERE user_id = $${paramCount}
      RETURNING user_id, display_name, bio, website, location, is_private, is_verified, 
                followers_count::text, following_count::text, posts_count::text, 
                gender, birth_date, safe_mode, created_at, updated_at
    `;

    const result = await pool.query(query, values);
    const user = result.rows[0];
    const userIds = [user.user_id];
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    user.media = userMediaMap[user.user_id] || [];
    if (!user.profile_picture_url && user.media.length > 0) {
      user.profile_picture_url = user.media[0].file_path;
    }
    const mappedUser = toCamel(user);
    return mappedUser;
  }

  /**
   * Activate suspended account
   */
  async activateSuspendedAccount(userId: string): Promise<User> {
    const query = `
      UPDATE users 
      SET account_status = 'active', updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1 AND account_status = 'suspended'
      RETURNING user_id, username, email, is_online, account_status, created_at, updated_at
    `;
    const result = await pool.query(query, [userId]);
    const user = result.rows[0];
    if (!user) {
      throw new Error(`User ${userId} is not suspended`);
    }
    sInfo(`User ${user} activated`);
    const userIds = [user.user_id];
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    user.media = userMediaMap[user.user_id] || [];
    if (!user.profile_picture_url && user.media.length > 0) {
      user.profile_picture_url = user.media[0].file_path;
    }
    return toCamel(user);
  }

  /**
   * Get users with filters and pagination
   */
  async getUsers(filters: UserFilters = {}): Promise<UserWithProfile[]> {
    const { page = 1, limit = 20, search, verified, status } = filters;
    const offset = (page - 1) * parseInt(String(limit), 10);

    let query = `
SELECT
u.user_id,
  u.username,
  u.is_online,
  u.email,
  u.account_status,
  u.created_at,
  up.display_name,
  up.is_verified,
  up.followers_count::text,
  up.following_count::text,
  up.posts_count::text
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE 1 = 1
  `;

    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      query += ` AND(u.username ILIKE $${paramCount} OR up.display_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (verified !== undefined) {
      query += ` AND up.is_verified = $${paramCount} `;
      params.push(verified === "true" || verified === true);
      paramCount++;
    }

    if (status) {
      query += ` AND u.account_status = $${paramCount} `;
      params.push(status);
      paramCount++;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1
      } `;
    params.push(parseInt(String(limit), 10), offset);

    const result = await pool.query(query, params);
    const users = result.rows;
    const userIds = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(userIds);
    users.forEach(u => {
      u.media = userMediaMap[u.user_id] || [];
      u.profile_picture_url = u.media[0]?.file_path || null;
    })
    return toCamel(users);
  }

  /**
   * Get total count of users with filters
   */
  async getUsersCount(filters: UserFilters = {}): Promise<number> {
    const { search, verified, status } = filters;

    let query = `
      SELECT COUNT(*) as total
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE 1 = 1
  `;

    const params: any[] = [];
    let paramCount = 1;

    if (search) {
      query += ` AND(u.username ILIKE $${paramCount} OR up.display_name ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    if (verified !== undefined) {
      query += ` AND up.is_verified = $${paramCount} `;
      params.push(verified === "true" || verified === true);
      paramCount++;
    }

    if (status) {
      query += ` AND u.account_status = $${paramCount} `;
      params.push(status);
      paramCount++;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total, 10);
  }

  async getUserById(
    userId: string,
    requesterId: string | null = null
  ): Promise<UserWithProfile | undefined> {
    let query = `
      SELECT
        u.user_id, u.username, u.is_online, u.email, u.created_at, u.last_login_at,
        up.display_name, up.bio, up.website, up.location, up.is_private, up.is_verified,
        up.followers_count::text, up.following_count::text, up.posts_count::text
      FROM users u
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.user_id = $1 AND u.account_status = 'active'
    `;
    const result = await pool.query(query, [userId]);
    let user = result.rows[0];
    if (!user) return undefined;

    const userMediaMap = await mediaRepository.getUsersMedia([userId]);
    user.media = userMediaMap[userId] || [];
    user.profile_picture_url = user.media[0]?.file_path || null;
    user = toCamel(user);

    // Always hydrate requester-specific fields if needed
    if (requesterId && requesterId !== userId) {
      const followStatusQuery = `
        SELECT
          EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 AND status = 'accepted') as is_following,
          EXISTS(SELECT 1 FROM blocked_users WHERE blocker_id = $2 AND blocked_id = $1) as is_blocked_by_user,
          EXISTS(SELECT 1 FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2) as is_blocking_user
      `;
      const fsResult = await pool.query(followStatusQuery, [requesterId, userId]);
      const fs = fsResult.rows[0];
      return {
        ...user,
        isFollowing: fs.is_following,
        isBlockedByUser: fs.is_blocked_by_user,
        isBlockingUser: fs.is_blocking_user
      };
    }

    return {
      ...user,
      isFollowing: user.isFollowing ?? false,
      isBlockedByUser: user.isBlockedByUser ?? false,
      isBlockingUser: user.isBlockingUser ?? false
    };
  }

  /**
   * Get user by username with optional requester context
   */
  async getUserByUsername(
    username: string,
    requesterId: string | null = null
  ): Promise<UserWithProfile | undefined> {
    let query = `
SELECT
u.user_id,
  u.username,
  u.is_online,
  u.email,
  u.created_at,
  u.last_login_at,
  up.display_name,
  up.bio,
  up.website,
  up.location,
  up.is_private,
  up.is_verified,
  up.followers_count::text,
  up.following_count::text,
  up.posts_count::text
    `;

    const params: any[] = [username];
    let paramCount = 2;

    if (requesterId) {
      query += `,
  EXISTS(
    SELECT 1 FROM follows 
          WHERE follower_id = $${paramCount} 
            AND following_id = u.user_id 
            AND status = 'accepted'
  ) as is_following,
  EXISTS(
    SELECT 1 FROM blocked_users 
          WHERE blocker_id = u.user_id 
            AND blocked_id = $${paramCount}
  ) as is_blocked_by_user,
  EXISTS(
    SELECT 1 FROM blocked_users 
          WHERE blocker_id = $${paramCount} 
            AND blocked_id = u.user_id
  ) as is_blocking_user
`;
      params.push(requesterId);
    } else {
      query += `,
  false as is_following,
  false as is_blocked_by_user,
  false as is_blocking_user
`;
    }

    query += `
      FROM users u
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.username = $1 AND u.account_status = 'active'
  `;

    const result = await pool.query(query, params);
    const user = result.rows[0];
    const userMediaMap = await mediaRepository.getUsersMedia([user.user_id]);
    user.media = userMediaMap[user.user_id] || [];
    user.profile_picture_url = user.media[0]?.file_path || null;
    return toCamel(user);
  }

  /**
   * Get current user's full profile
   */
  async getMe(userId: string): Promise<UserWithProfile | undefined> {
    const query = `
SELECT
u.user_id,
  u.username,
  u.is_online,
  u.email,
  u.email_verified,
  u.account_status,
  u.created_at,
  u.last_login_at,
  up.display_name,
  up.bio,
  up.website,
  up.location,
  up.is_private,
  up.is_verified,
  up.followers_count::text,
  up.following_count::text,
  up.posts_count::text
      FROM users u
      JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.user_id = $1
  `;

    const result = await pool.query(query, [userId]);
    const user = result.rows[0];
    const userMediaMap = await mediaRepository.getUsersMedia([user.user_id]);
    user.media = userMediaMap[user.user_id] || [];
    user.profile_picture_url = user.media[0]?.file_path || null;
    return toCamel(user);
  }
  /**
   * Get Current User 
   */
  async getCurrentUser(userId: string): Promise<UserWithProfile | undefined> {
    const query = `
SELECT
u.user_id,
  u.username,
  u.is_online,
  u.email,
  u.email_verified,
  u.account_status,
  u.created_at,
  u.last_login_at
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.user_id = $1
  `;

    const result = await pool.query(query, [userId]);
    const user = result.rows[0];
    const userMediaMap = await mediaRepository.getUsersMedia([user.user_id]);
    user.media = userMediaMap[user.user_id] || [];
    user.profile_picture_url = user.media[0]?.file_path || null;
    return toCamel(user);
  }

  /**
   * Deactivate user account
   */
  async deactivateUser(userId: string): Promise<User> {
    const query = `
      UPDATE users 
      SET account_status = 'deactivated', updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1
      RETURNING user_id, username, email, is_online, account_status, created_at, updated_at
  `;
    const result = await pool.query(query, [userId]);
    const user = result.rows[0];
    const userMediaMap = await mediaRepository.getUsersMedia([user.user_id]);
    user.media = userMediaMap[user.user_id] || [];
    user.profile_picture_url = user.media[0]?.file_path || null;
    return toCamel(user);
  }

  /**
   * Create or update follow relationship
   */
  /**
   * Create or update follow relationship
   */
  async createFollow(
    followerId: string,
    followingId: string,
    status: string = "accepted",
    client?: PoolClient
  ): Promise<Follow> {
    const query = `
      INSERT INTO follows(follower_id, following_id, status, created_at, updated_at)
VALUES($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ON CONSTRAINT follows_pkey
      DO UPDATE SET status = $3, updated_at = CURRENT_TIMESTAMP
RETURNING *
  `;
    const db = client || pool;
    const result = await db.query(query, [followerId, followingId, status]);
    return toCamel(result.rows[0]);
  }

  /**
   * Delete follow relationship
   */
  async deleteFollow(
    followerId: string,
    followingId: string,
    client?: PoolClient
  ): Promise<Follow> {
    const query =
      "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING *";
    const db = client || pool;
    const result = await db.query(query, [followerId, followingId]);
    return toCamel(result.rows[0]);
  }

  /**
   * Get followers count for a user from follows table
   */
  async getFollowersCount(userId: string, client?: PoolClient): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM follows 
      WHERE following_id = $1 AND status = 'accepted'
  `;
    const db = client || pool;
    const result = await db.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Get following count for a user from follows table
   */
  async getFollowingCount(userId: string, client?: PoolClient): Promise<number> {
    const query = `
      SELECT COUNT(*) as count 
      FROM follows 
      WHERE follower_id = $1 AND status = 'accepted'
  `;
    const db = client || pool;
    const result = await db.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Update followers count in user_profiles
   */
  async updateFollowersCount(userId: string, count: number, client?: PoolClient): Promise<void> {
    const query = `
      UPDATE user_profiles 
      SET followers_count = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1
    `;
    const db = client || pool;
    await db.query(query, [userId, count]);
  }

  /**
   * Update following count in user_profiles
   */
  async updateFollowingCount(userId: string, count: number, client?: PoolClient): Promise<void> {
    const query = `
      UPDATE user_profiles 
      SET following_count = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $1
    `;
    const db = client || pool;
    await db.query(query, [userId, count]);
  }

  /**
   * Check if user is private
   */
  async isUserPrivate(userId: string): Promise<boolean> {
    const query = "SELECT is_private FROM user_profiles WHERE user_id = $1";
    const result = await pool.query(query, [userId]);
    return result.rows[0]?.is_private || false;
  }

  /**
   * Get follow status between two users
   */
  async getFollowStatus(followerId: string, followingId: string): Promise<{ isFollowing: boolean; isFollower: boolean }> {
    const query = `
        SELECT
          EXISTS(
            SELECT 1 FROM follows 
            WHERE follower_id = $1 AND following_id = $2 AND status = 'accepted'
          ) as is_following,
          EXISTS(
            SELECT 1 FROM follows 
            WHERE follower_id = $2 AND following_id = $1 AND status = 'accepted'
          ) as is_follower
      `;
    const result = await pool.query(query, [followerId, followingId]);
    return {
      isFollowing: result.rows[0].is_following,
      isFollower: result.rows[0].is_follower
    };
  }

  /**
   * Get user profile with follow status
   */
  async getUserProfile(
    userId: string,
    requesterId: string | null = null
  ): Promise<UserProfileWithFollow | null> {
    const query = `
      SELECT user_id, display_name, bio, website, location, is_private, is_verified, 
             followers_count::text, following_count::text, posts_count::text, 
             gender, birth_date, safe_mode, created_at, updated_at
      FROM user_profiles WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return null;
    }

    const profile = result.rows[0];
    const userMediaMap = await mediaRepository.getUsersMedia([userId]);
    const userMedia = userMediaMap[userId] || [];

    let isFollowing = false;
    let isFollower = false;

    if (requesterId) {
      const followQuery = `
        SELECT
          EXISTS(
            SELECT 1 FROM follows 
            WHERE follower_id = $1 AND following_id = $2 AND status = 'accepted'
          ) as is_following,
          EXISTS(
            SELECT 1 FROM follows 
            WHERE follower_id = $2 AND following_id = $1 AND status = 'accepted'
          ) as is_follower
      `;
      const followResult = await pool.query(followQuery, [requesterId, userId]);
      isFollowing = followResult.rows[0].is_following;
      isFollower = followResult.rows[0].is_follower;
    }

    profile.profile_picture_url = userMedia[0]?.file_path || null;

    return {
      ...toCamel(profile),
      isFollowing,
      isFollower,
      media: toCamel(userMedia),
    };
  }

  /**
   * Begin transaction
   */
  async beginTransaction(): Promise<PoolClient> {
    const client = await pool.connect();
    await client.query("BEGIN");
    return client;
  }

  /**
   * Commit transaction
   */
  async commitTransaction(client: PoolClient): Promise<void> {
    await client.query("COMMIT");
    client.release();
  }

  /**
   * Rollback transaction
   */
  async rollbackTransaction(client: PoolClient): Promise<void> {
    await client.query("ROLLBACK");
    client.release();
  }

  /**
   * Get user's safe mode preference
   */
  async getUserSafeMode(userId: string): Promise<number> {
    const query = 'SELECT safe_mode FROM user_profiles WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    // Default to 1 (Medium) if not found or null
    return result.rows[0]?.safe_mode ?? 1;
  }

  /**
   * Get user activity log (likes, comments, shares, follows)
   */
  async getActivityLog(
    userId: string,
    page: number,
    limit: number,
    typeFilter?: string
  ): Promise<any[]> {
    const offset = (page - 1) * limit;

    let queries: string[] = [];
    const params: any[] = [userId];
    let paramCount = 2;

    const likeQuery = `
      SELECT 'like'::TEXT as action_type, target_type::TEXT, target_id::TEXT, created_at::TIMESTAMPTZ,
        (CASE 
          WHEN target_type = 'post' THEN (SELECT caption FROM posts WHERE post_id = l.target_id)
          WHEN target_type = 'reel' THEN (SELECT caption FROM reels WHERE reel_id = l.target_id)
          WHEN target_type = 'comment' THEN (SELECT content FROM comments WHERE comment_id = l.target_id)
          ELSE NULL 
        END)::TEXT as metadata
      FROM likes l WHERE l.user_id = $1
    `;

    const commentQuery = `
      SELECT 'comment'::TEXT as action_type, target_type::TEXT, target_id::TEXT, created_at::TIMESTAMPTZ, content::TEXT as metadata
      FROM comments WHERE user_id = $1
    `;

    const shareQuery = `
      SELECT 'share'::TEXT as action_type, 'post'::TEXT as target_type, post_id::TEXT as target_id, shared_at::TIMESTAMPTZ as created_at,
        (SELECT caption FROM posts WHERE post_id = ps.post_id)::TEXT as metadata
      FROM post_shares ps WHERE user_id = $1
    `;

    const followQuery = `
      SELECT 'follow'::TEXT as action_type, 'user'::TEXT as target_type, following_id::TEXT as target_id, created_at::TIMESTAMPTZ,
        (SELECT username FROM users WHERE user_id = f.following_id)::TEXT as metadata
      FROM follows f WHERE follower_id = $1 AND status = 'accepted'
    `;

    if (typeFilter) {
      if (typeFilter === 'like') queries.push(likeQuery);
      if (typeFilter === 'comment') queries.push(commentQuery);
      if (typeFilter === 'share') queries.push(shareQuery);
      if (typeFilter === 'follow') queries.push(followQuery);
    } else {
      queries = [likeQuery, commentQuery, shareQuery, followQuery];
    }

    const finalQuery = `
      SELECT * FROM (
        ${queries.join(' UNION ALL ')}
      ) AS activity
      ORDER BY created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    params.push(limit, offset);

    const result = await pool.query(finalQuery, params);
    return toCamel(result.rows);
  }
}

export default new UserRepository();