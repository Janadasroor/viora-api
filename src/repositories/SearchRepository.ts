import { pool } from '../config/pg.config.js';
import type {
  PostSearchResult, LocationSearchResult, HashtagSearchResult,
  UserSearchResult, SearchSuggestion, SortBy, SuggestionType, UnifiedSearchResult, MediaResult
} from '@types';
import { sDebug, sError } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';
import mediaRepository from './MediaRepository.js';
class SearchRepository {
  /**
   * Search Posts with pagination
   * @param searchQuery - Search term
   * @param page - Page number
   * @param limit - Items per page
   * @param sortBy - Sort option: 'relevance', 'recent', 'popular'
   * @param userId - Current user ID (optional)
   * @returns Array of posts
   */
  async searchPosts(
    searchQuery: string,
    cursor: string | null = null,
    limit: number,
    sortBy: SortBy = 'relevance',
    userId: string | null = null
  ): Promise<{ posts: PostSearchResult[], nextCursor?: string }> {
    let cursorScore: number | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('ascii');
        const [scoreStr, idStr] = decoded.split(',');
        if (scoreStr && idStr) {
          cursorScore = parseFloat(scoreStr);
          cursorId = idStr;
        }
      } catch (e) {
        sError('Invalid search cursor:', e);
      }
    }

    const searchTerm = searchQuery.trim();
    // For FTS matching
    const ftsQuery = searchTerm.split(/\s+/).filter(t => t.length > 0).join(' & ');

    // Build the ORDER BY clause
    let orderClause: string;
    switch (sortBy) {
      case 'recent':
        orderClause = 'created_at DESC';
        break;
      case 'popular':
        orderClause = 'likes_count DESC, comments_count DESC, created_at DESC';
        break;
      case 'relevance':
      default:
        orderClause = 'relevance_score DESC, created_at DESC';
    }

    let paramIndex = 1;
    const params: (number | string | Date)[] = [];

    // Build user-specific clauses
    let userLikedClause: string;
    let userSavedClause: string;
    let isFollowingClause: string;

    if (userId) {
      userLikedClause = `EXISTS(SELECT 1 FROM likes l WHERE l.target_type = 'post' AND l.target_id = p.post_id AND l.user_id = $${paramIndex++})`;
      params.push(userId);
      userSavedClause = `EXISTS(SELECT 1 FROM saved_posts sp WHERE sp.saved_id = p.post_id AND sp.user_id = $${paramIndex++})`;
      params.push(userId);
      isFollowingClause = `EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $${paramIndex++} AND f.following_id = p.user_id)`;
      params.push(userId);
    } else {
      userLikedClause = 'false';
      userSavedClause = 'false';
      isFollowingClause = 'false';
    }

    // Add cursor conditions
    let cursorCondition = 'TRUE';
    if (cursorScore !== null && cursorId !== null) {
      if (sortBy === 'recent') {
        const cursorDate = new Date(cursorScore); // Score is timestamp for recent
        cursorCondition = `(created_at < $${paramIndex++}) OR (created_at = $${paramIndex - 1} AND post_id < $${paramIndex++})`;
        params.push(cursorDate, cursorId);
      } else if (sortBy === 'popular') {
        cursorCondition = `(likes_count < $${paramIndex++}) OR (likes_count = $${paramIndex - 1} AND post_id < $${paramIndex++})`;
        params.push(cursorScore, cursorId);
      } else {
        // relevance
        cursorCondition = `(relevance_score < $${paramIndex++}) OR (relevance_score = $${paramIndex - 1} AND post_id < $${paramIndex++})`;
        params.push(cursorScore, cursorId);
      }
    }

    // Add limit
    params.push(limit);
    const limitParamIdx = paramIndex++;

    // For FTS match
    params.push(ftsQuery);
    const ftsParamIdx = paramIndex++;

    // ILIKE fallback/additional matches
    const searchTermIlike = `%${searchTerm}%`;
    params.push(searchTermIlike);
    const ilikeParamIdx = paramIndex++;

    const query = `
      WITH search_results AS (
        SELECT 
          p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
          p.location, p.likes_count, p.comments_count, p.shares_count,
          p.views_count, p.created_at,
          u.username, up.display_name, up.is_verified,
          ${userLikedClause} as user_liked,
          ${userSavedClause} as user_saved,
          ${isFollowingClause} as is_following,
          (
            CASE WHEN p.caption @@ to_tsquery('english', $${ftsParamIdx}) THEN 15 ELSE 0 END +
            CASE WHEN p.caption ILIKE $${ilikeParamIdx} THEN 5 ELSE 0 END +
            CASE WHEN EXISTS(
              SELECT 1 FROM post_hashtags ph3 
              JOIN hashtags h3 ON ph3.hashtag_id = h3.hashtag_id 
              WHERE ph3.post_id = p.post_id AND h3.tag_name ILIKE $${ilikeParamIdx}
            ) THEN 15 ELSE 0 END +
            CASE WHEN p.location ILIKE $${ilikeParamIdx} THEN 5 ELSE 0 END +
            CASE WHEN u.username ILIKE $${ilikeParamIdx} THEN 8 ELSE 0 END +
            CASE WHEN up.display_name ILIKE $${ilikeParamIdx} THEN 7 ELSE 0 END +
            (p.likes_count * 0.1) +
            (p.comments_count * 0.2) +
            (p.views_count * 0.05)
          ) as relevance_score
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        WHERE p.is_archived = false 
          AND u.account_status = 'active'
          AND p.visibility = 'public'
          AND (
            p.caption @@ to_tsquery('english', $${ftsParamIdx}) OR
            p.caption ILIKE $${ilikeParamIdx} OR
            EXISTS(
              SELECT 1 FROM post_hashtags ph2 
              JOIN hashtags h2 ON ph2.hashtag_id = h2.hashtag_id 
              WHERE ph2.post_id = p.post_id AND h2.tag_name ILIKE $${ilikeParamIdx}
            ) OR
            p.location ILIKE $${ilikeParamIdx} OR
            u.username ILIKE $${ilikeParamIdx} OR
            up.display_name ILIKE $${ilikeParamIdx}
          )
      )
      SELECT *,
        (SELECT STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) 
         FROM post_hashtags ph 
         JOIN hashtags h ON ph.hashtag_id = h.hashtag_id 
         WHERE ph.post_id = search_results.post_id) as hashtags,
         likes_count::text, comments_count::text, shares_count::text, views_count::text
      FROM search_results
      WHERE ${cursorCondition}
      ORDER BY ${orderClause}, post_id DESC
      LIMIT $${limitParamIdx}
    `;

    const queryResult = await pool.query(query, params);
    const posts = queryResult.rows;
    const postIds = posts.map(p => p.post_id);
    const userIds = Array.from(new Set(posts.map(p => p.user_id)));
    const [postMediaMap, userMediaMap] = await Promise.all([
      mediaRepository.getPostsMedia(postIds),
      mediaRepository.getUsersMedia(userIds)
    ]);

    posts.forEach(post => {
      post.media = postMediaMap[post.post_id] || [];
      const userMedia = userMediaMap[post.user_id] || [];
      post.profile_picture_url = userMedia[0]?.file_path || null;
    });

    let nextCursor: string | undefined;
    if (posts.length === limit) {
      const lastPost = posts[posts.length - 1];
      let score: any;
      if (sortBy === 'recent') {
        score = new Date(lastPost.created_at).getTime();
      } else if (sortBy === 'popular') {
        score = lastPost.likes_count;
      } else {
        score = lastPost.relevance_score;
      }
      nextCursor = Buffer.from(`${score},${lastPost.post_id}`).toString('base64');
    }

    const searchResults: { posts: PostSearchResult[], nextCursor?: string } = {
      posts: (toCamel(posts) as PostSearchResult[]) ?? []
    };
    if (nextCursor) {
      searchResults.nextCursor = nextCursor;
    }

    return searchResults;
  }

  /**
   * Search Users with pagination
   * @param searchQuery - Search term
   * @param page - Page number
   * @param limit - Items per page
   * @param userId - Current user ID (optional)
   * @returns Array of users
   */
  async searchUsers(
    searchQuery: string,
    cursor: string | null = null,
    limit: number,
    userId: string | null = null
  ): Promise<{ users: UserSearchResult[], nextCursor?: string }> {
    let cursorScore: number | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('ascii');
        const [scoreStr, idStr] = decoded.split(',');
        if (scoreStr && idStr) {
          cursorScore = parseFloat(scoreStr);
          cursorId = idStr;
        }
      } catch (e) {
        sError('Invalid user search cursor:', e);
      }
    }

    const searchTerm = `%${searchQuery.trim()}%`;

    let paramIndex = 1;
    const params: (number | string | Date)[] = [];

    // Build user-specific clauses
    let isFollowingClause: string;
    let followsYouClause: string;

    if (userId) {
      isFollowingClause = `EXISTS(SELECT 1 FROM follows WHERE follower_id = $${paramIndex++} AND following_id = u.user_id)`;
      params.push(userId);
      followsYouClause = `EXISTS(SELECT 1 FROM follows WHERE follower_id = u.user_id AND following_id = $${paramIndex++})`;
      params.push(userId);
    } else {
      isFollowingClause = 'false';
      followsYouClause = 'false';
    }

    // Relevance score params (3 instances)
    const relevanceParams = Array(3).fill(null).map(() => {
      params.push(searchTerm);
      return `$${paramIndex++}`;
    });

    // WHERE clause params (3 instances)
    const whereParams = Array(3).fill(null).map(() => {
      params.push(searchTerm);
      return `$${paramIndex++}`;
    });

    // Add cursor condition
    let cursorCondition = 'TRUE';
    if (cursorScore !== null && cursorId !== null) {
      cursorCondition = `(relevance_score < $${paramIndex++}) OR (relevance_score = $${paramIndex - 1} AND u.user_id < $${paramIndex++})`;
      params.push(cursorScore, cursorId);
    }

    // Add limit
    params.push(limit);
    const limitParamIdx = paramIndex++;

    const query = `
      WITH search_results AS (
        SELECT 
          u.user_id, u.username, u.account_status,
          up.display_name, up.bio, up.is_verified,
          COALESCE(up.followers_count, 0)::text as followers_count, 
          COALESCE(up.following_count, 0)::text as following_count, 
          COALESCE(up.posts_count, 0)::text as posts_count,
          ${isFollowingClause} as is_following,
          ${followsYouClause} as follows_you,
          (
            CASE WHEN u.username ILIKE ${relevanceParams[0]} THEN 20 ELSE 0 END +
            CASE WHEN up.display_name ILIKE ${relevanceParams[1]} THEN 15 ELSE 0 END +
            CASE WHEN up.bio ILIKE ${relevanceParams[2]} THEN 5 ELSE 0 END +
            (COALESCE(up.followers_count, 0) * 0.01) +
            (COALESCE(up.posts_count, 0) * 0.005)
          ) as relevance_score
        FROM users u
        JOIN user_profiles up ON u.user_id = up.user_id
        WHERE u.account_status = 'active'
          AND (
            u.username ILIKE ${whereParams[0]} OR
            up.display_name ILIKE ${whereParams[1]} OR
            up.bio ILIKE ${whereParams[2]}
          )
      )
      SELECT * FROM search_results
      WHERE ${cursorCondition}
      ORDER BY relevance_score DESC, followers_count DESC, user_id DESC
      LIMIT $${limitParamIdx}
    `;

    const queryResult = await pool.query(query, params);
    const users = queryResult.rows;
    const userIds = users.map(u => u.user_id);
    const userMediaMap = await mediaRepository.getUsersMedia(userIds)
    users.forEach(user => {
      user.media = userMediaMap[user.user_id] || [];
      user.profile_picture_url = user.media[0]?.file_path || null;
    });

    let nextCursor: string | undefined;
    if (users.length === limit) {
      const lastUser = users[users.length - 1];
      nextCursor = Buffer.from(`${lastUser.relevance_score},${lastUser.user_id}`).toString('base64');
    }

    const searchResults: { users: UserSearchResult[], nextCursor?: string } = {
      users: (toCamel(users) as UserSearchResult[]) ?? []
    };
    if (nextCursor) {
      searchResults.nextCursor = nextCursor;
    }

    return searchResults;
  }

  /**
   * Search Hashtags with pagination
   * @param searchQuery - Search term
   * @param page - Page number
   * @param limit - Items per page
   * @returns Array of hashtags
   */
  async searchHashtags(
    searchQuery: string,
    cursor: string | null = null,
    limit: number
  ): Promise<{ hashtags: HashtagSearchResult[], nextCursor?: string }> {
    let cursorScore: number | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('ascii');
        const [scoreStr, idStr] = decoded.split(',');
        if (scoreStr && idStr) {
          cursorScore = parseFloat(scoreStr);
          cursorId = idStr;
        }
      } catch (e) {
        sError('Invalid hashtag search cursor:', e);
      }
    }

    // Remove # if user included it
    const cleanQuery = searchQuery.trim().replace(/^#/, '');
    const searchTerm = `%${cleanQuery}%`;
    const exactMatch = `${cleanQuery}%`;

    const params: (number | string | Date)[] = [exactMatch, searchTerm, searchTerm, limit];

    let cursorCondition = 'TRUE';
    let paramIdx = 5;
    if (cursorScore !== null && cursorId !== null) {
      cursorCondition = `(relevance_score < $${paramIdx++}) OR (relevance_score = $${paramIdx - 1} AND hashtag_id < $${paramIdx++})`;
      params.push(cursorScore, cursorId);
    }

    const finalQuery = `
      WITH search_results AS (
        SELECT 
          hashtag_id, 
          tag_name, 
          posts_count::text, 
          trending_score::text,
          is_trending,
          created_at,
          (
            CASE WHEN tag_name ILIKE $1 THEN 50 ELSE 0 END +
            CASE WHEN tag_name ILIKE $2 THEN 30 ELSE 0 END +
            (posts_count * 0.1) +
            (trending_score * 2)
          ) as relevance_score
        FROM hashtags
        WHERE tag_name ILIKE $3
      )
      SELECT * FROM search_results
      WHERE ${cursorCondition}
      ORDER BY relevance_score DESC, posts_count DESC, hashtag_id DESC
      LIMIT $4
    `;

    const queryResult = await pool.query(finalQuery, params);
    const hashtags = queryResult.rows;

    let nextCursor: string | undefined;
    if (hashtags.length === limit) {
      const lastHashtag = hashtags[hashtags.length - 1];
      nextCursor = Buffer.from(`${lastHashtag.relevance_score},${lastHashtag.hashtag_id}`).toString('base64');
    }

    const searchResults: { hashtags: HashtagSearchResult[], nextCursor?: string } = {
      hashtags: (toCamel(hashtags) as HashtagSearchResult[]) ?? []
    };
    if (nextCursor) {
      searchResults.nextCursor = nextCursor;
    }

    return searchResults;
  }

  /**
   * Search Locations with pagination
   * @param searchQuery - Search term
   * @param page - Page number
   * @param limit - Items per page
   * @returns Array of locations
   */
  async searchLocations(
    searchQuery: string,
    cursor: string | null = null,
    limit: number
  ): Promise<{ locations: LocationSearchResult[], nextCursor?: string }> {
    let cursorScore: number | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('ascii');
        const [scoreStr, idStr] = decoded.split(',');
        if (scoreStr && idStr) {
          cursorScore = parseFloat(scoreStr);
          cursorId = idStr;
        }
      } catch (e) {
        sError('Invalid location search cursor:', e);
      }
    }

    const searchTerm = `%${searchQuery.trim()}%`;

    let cursorCondition = 'TRUE';
    if (cursorScore !== null && cursorId !== null) {
      cursorCondition = `(COUNT(*) < $3) OR (COUNT(*) = $3 AND location < $4)`;
    }

    const query = `
      WITH search_results AS (
        SELECT 
          location,
          COUNT(*) as raw_posts_count,
          MAX(created_at) as last_post_at
        FROM posts
        WHERE location ILIKE $1
          AND location IS NOT NULL
          AND is_archived = false
          AND visibility = 'public'
        GROUP BY location
      )
      SELECT 
        location,
        raw_posts_count::text as posts_count,
        last_post_at
      FROM search_results
      WHERE ${cursorCondition.replace(/COUNT\(\*\)/g, 'raw_posts_count')}
      ORDER BY raw_posts_count DESC, last_post_at DESC, location DESC
      LIMIT $2
    `;

    const params: any[] = [searchTerm, limit];
    if (cursorScore !== null && cursorId !== null) {
      params.push(cursorScore, cursorId);
    }

    const result = await pool.query(query, params);
    const locations = (toCamel(result.rows) as LocationSearchResult[]) ?? [];

    let nextCursor: string | undefined;
    if (locations.length === limit) {
      const lastLoc = locations[locations.length - 1];
      if (lastLoc) {
        nextCursor = Buffer.from(`${lastLoc.postsCount},${lastLoc.location}`).toString('base64');
      }
    }

    const response: { locations: LocationSearchResult[], nextCursor?: string } = {
      locations
    };
    if (nextCursor) {
      response.nextCursor = nextCursor;
    }
    return response;
  }

  /**
   * Unified search - top results across all types
   * @param searchQuery - Search term
   * @param userId - Current user ID (optional)
   * @param topLimit - Number of top results per category (default: 5)
   * @returns Object with posts, users, hashtags, locations
   */
  async unifiedSearch(
    searchQuery: string,
    userId: string | null = null,
    topLimit: number = 5
  ): Promise<UnifiedSearchResult> {
    const searchTerm = `%${searchQuery.trim()}%`;
    const cleanHashtag = searchQuery.trim().replace(/^#/, '');
    const hashtagTerm = `%${cleanHashtag}%`;

    // Build posts query
    let postsParamIndex = 1;
    const postsParams: (number | string)[] = [];

    let postsUserLiked: string;
    let postsUserSaved: string;
    let postsIsFollowing: string;
    if (userId) {
      postsUserLiked = `EXISTS(SELECT 1 FROM likes l WHERE l.target_type = 'post' AND l.target_id = p.post_id AND l.user_id = $${postsParamIndex++})`;
      postsParams.push(userId);
      postsUserSaved = `EXISTS(SELECT 1 FROM saved_posts sp WHERE sp.saved_id = p.post_id AND sp.user_id = $${postsParamIndex++})`;
      postsParams.push(userId);
      postsIsFollowing = `EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $${postsParamIndex++} AND f.following_id = p.user_id)`;
      postsParams.push(userId);
    } else {
      postsUserLiked = 'false';
      postsUserSaved = 'false';
      postsIsFollowing = 'false';
    }

    // Add search term params for posts
    const postsSearchParams = Array(5).fill(null).map(() => {
      postsParams.push(searchTerm);
      return `$${postsParamIndex++}`;
    });

    postsParams.push(topLimit);
    const postsLimitParam = `$${postsParamIndex++}`;

    sDebug('[SearchRepository] Posts search params:', {
      searchTerm,
      postsParams,
      userId,
    });

    const postsQuery = `
      SELECT 
        p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
        p.location, p.likes_count::text, p.comments_count::text, p.shares_count::text,
        p.views_count::text, p.created_at,
        u.username, 
        COALESCE(up.display_name, u.username) as display_name, 
        COALESCE(up.is_verified, false) as is_verified,
        ${postsUserLiked} as user_liked,
        ${postsUserSaved} as user_saved,
        ${postsIsFollowing} as is_following,
        STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) as hashtags,
        (
          CASE WHEN p.caption ILIKE ${postsSearchParams[0]} THEN 10 ELSE 0 END +
          CASE WHEN EXISTS(
            SELECT 1 FROM post_hashtags ph3 
            JOIN hashtags h3 ON ph3.hashtag_id = h3.hashtag_id 
            WHERE ph3.post_id = p.post_id AND h3.tag_name ILIKE ${postsSearchParams[1]}
          ) THEN 15 ELSE 0 END +
          CASE WHEN p.location ILIKE ${postsSearchParams[2]} THEN 5 ELSE 0 END +
          (p.likes_count * 0.1) +
          (p.comments_count * 0.2)
        ) as relevance_score
      FROM posts p
      JOIN users u ON p.user_id = u.user_id
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      LEFT JOIN post_hashtags ph ON p.post_id = ph.post_id
      LEFT JOIN hashtags h ON ph.hashtag_id = h.hashtag_id
      WHERE p.is_archived = false 
        AND u.account_status = 'active'
        AND p.visibility = 'public'
        AND (
          (p.caption IS NOT NULL AND p.caption ILIKE ${postsSearchParams[3]}) 
          OR (p.location IS NOT NULL AND p.location ILIKE ${postsSearchParams[4]})
          OR EXISTS(
            SELECT 1 FROM post_hashtags ph2 
            JOIN hashtags h2 ON ph2.hashtag_id = h2.hashtag_id 
            WHERE ph2.post_id = p.post_id AND h2.tag_name ILIKE ${postsSearchParams[3]}
          )
        )
      GROUP BY p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
               p.location, p.likes_count, p.comments_count, p.shares_count,
               p.views_count, p.created_at, u.username, up.display_name,
               up.is_verified
      ORDER BY relevance_score DESC, p.created_at DESC
      LIMIT ${postsLimitParam}
    `;

    // Build users query
    let usersParamIndex = 1;
    const usersParams: (number | string)[] = [];

    let usersIsFollowing: string;
    let usersFollowsYou: string;

    if (userId) {
      usersIsFollowing = `EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $${usersParamIndex++} AND f.following_id = u.user_id)`;
      usersParams.push(userId);
      usersFollowsYou = `EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.user_id AND f.following_id = $${usersParamIndex++})`;
      usersParams.push(userId);
    } else {
      usersIsFollowing = 'false';
      usersFollowsYou = 'false';
    }

    // Add search term params for users
    const usersSearchParams = Array(4).fill(null).map(() => {
      usersParams.push(searchTerm);
      return `$${usersParamIndex++}`;
    });

    usersParams.push(topLimit);
    const usersLimitParam = `$${usersParamIndex++}`;

    const usersQuery = `
      SELECT 
        u.user_id, u.username, u.account_status,
        COALESCE(up.display_name, u.username) as display_name, 
        up.bio,
        COALESCE(up.is_verified, false) as is_verified,
        COALESCE(up.followers_count, 0)::text as followers_count, 
        COALESCE(up.following_count, 0)::text as following_count, 
        COALESCE(up.posts_count, 0)::text as posts_count,
        ${usersIsFollowing} as is_following,
        ${usersFollowsYou} as follows_you,
        (
          CASE WHEN u.username ILIKE ${usersSearchParams[0]} THEN 20 ELSE 0 END +
          CASE WHEN up.display_name ILIKE ${usersSearchParams[1]} THEN 15 ELSE 0 END +
          (COALESCE(up.followers_count, 0) * 0.01)
        ) as relevance_score
      FROM users u
      LEFT JOIN user_profiles up ON u.user_id = up.user_id
      WHERE u.account_status = 'active'
        AND (u.username ILIKE ${usersSearchParams[2]} OR up.display_name ILIKE ${usersSearchParams[3]})
      ORDER BY relevance_score DESC, COALESCE(up.followers_count, 0) DESC
      LIMIT ${usersLimitParam}
    `;

    // Execute all queries in parallel
    const [postsResult, usersResult, hashtagsResult, locationsResult] =
      await Promise.all([
        pool.query(postsQuery, postsParams),
        pool.query(usersQuery, usersParams),
        pool.query(`
          SELECT 
            hashtag_id, 
            tag_name, 
            posts_count::text, 
            trending_score::text,
            is_trending,
            created_at
          FROM hashtags
          WHERE tag_name ILIKE $1
          ORDER BY posts_count DESC, trending_score DESC
          LIMIT $2
        `, [hashtagTerm, topLimit]),
        pool.query(`
          SELECT 
            location,
            COUNT(*)::text as posts_count,
            MAX(created_at) as last_post_at
          FROM posts
          WHERE location ILIKE $1
            AND location IS NOT NULL
            AND is_archived = false
            AND visibility = 'public'
          GROUP BY location
          ORDER BY posts_count DESC, last_post_at DESC
          LIMIT $2
        `, [searchTerm, topLimit])
      ]);
    const postIds = postsResult.rows.map(p => p.post_id);
    const postMediaMap = await mediaRepository.getPostsMedia(postIds);
    const postsUserIds = Array.from(new Set(postsResult.rows.map(p => p.user_id)));
    const usersIds = usersResult.rows.map(u => u.user_id);
    const [postsUserMediaMap, usersMediaMap] = await Promise.all([
      mediaRepository.getUsersMedia(postsUserIds),
      mediaRepository.getUsersMedia(usersIds)
    ]);

    postsResult.rows.forEach(post => {
      post.media = postMediaMap[post.post_id] || [];
      const userMedia = postsUserMediaMap[post.user_id] || [];
      post.profile_picture_url = userMedia[0]?.file_path || null;
    });

    usersResult.rows.forEach(user => {
      user.media = usersMediaMap[user.user_id] || [];
      user.profile_picture_url = user.media[0]?.file_path || null;
    });

    return {
      posts: toCamel(postsResult.rows ?? []),
      users: toCamel(usersResult.rows ?? []),
      hashtags: toCamel(hashtagsResult.rows ?? []),
      locations: toCamel(locationsResult.rows ?? [])
    };
  }

  /**
   * Get search suggestions for autocomplete
   * @param searchQuery - Search term
   * @param type - Type filter: 'all', 'users', 'hashtags', 'locations'
   * @param suggestionLimit - Number of suggestions per type (default: 5)
   * @returns Array of suggestions
   */
  async getSearchSuggestions(
    searchQuery: string,
    type: SuggestionType = 'all',
    suggestionLimit: number = 5
  ): Promise<SearchSuggestion[]> {
    const searchTerm = `${searchQuery.trim()}%`; // Prefix match
    const suggestions: SearchSuggestion[] = [];

    if (type === 'all' || type === 'users') {
      const result = await pool.query(`
        SELECT 'user' as type, u.username as value, u.username as label, 
               (SELECT original_path FROM media m JOIN user_media um ON m.id = um.media_id WHERE um.user_id = u.user_id LIMIT 1) as image
        FROM users u
        JOIN user_profiles up ON u.user_id = up.user_id
        WHERE u.username ILIKE $1 AND u.account_status = 'active'
        ORDER BY up.followers_count DESC
        LIMIT $2
      `, [searchTerm, suggestionLimit]);
      suggestions.push(...(result.rows ?? []));
    }

    if (type === 'all' || type === 'hashtags') {
      const cleanQuery = searchQuery.trim().replace(/^#/, '');
      const hashtagTerm = `${cleanQuery}%`;

      const result = await pool.query(`
        SELECT 'hashtag' as type, '#' || tag_name as value, '#' || tag_name as label, NULL as image
        FROM hashtags
        WHERE tag_name ILIKE $1
        ORDER BY posts_count DESC
        LIMIT $2
      `, [hashtagTerm, suggestionLimit]);
      suggestions.push(...(result.rows ?? []));
    }

    if (type === 'all' || type === 'locations') {
      const result = await pool.query(`
        SELECT location as value, location as label, 'location' as type, NULL as image
        FROM posts
        WHERE location ILIKE $1 AND location IS NOT NULL
        GROUP BY location
        ORDER BY MAX(created_at) DESC
        LIMIT $2
      `, [searchTerm, suggestionLimit]);
      suggestions.push(...(result.rows ?? []));
    }

    return toCamel(suggestions);
  }
}

export default new SearchRepository();