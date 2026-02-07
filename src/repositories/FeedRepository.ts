import { pool } from "../config/pg.config.js";
import 'dotenv/config';
import type { FeedPost, TrendingHashtagItem } from "@types";
import mediaService from "../services/MediaService.js";
import { sDebug, sError, sInfo } from "sk-logger";
import { toCamel } from "@/utils/toCamel.js";
import mediaRepository from "./MediaRepository.js";
import redisService from "../cache/RedisService.js";
import cassandraFeedRepo from './CassandraFeedRepository.js';
import feedPrecomputeService from '../services/FeedPrecomputeService.js';



class FeedRepository {


  async getFeed(page: number = 1, limit: number = 20, userId: string, MIN_ENGAGEMENT: number, safeMode: number = 1, refresh: boolean = false): Promise<{ posts: FeedPost[], hasMore: boolean }> {
    try {
      const offset = (page - 1) * Number(limit);
      const unsafeLabels = this.getUnsafeLabels(safeMode);
      sDebug(`Loading feed for user ${userId} (SafeMode: ${safeMode}, Refresh: ${refresh}, Cache-First)...`);

      // 1. Try to fetch from Precomputed Cache
      sDebug(`[Tracing] Fetching cached feed from Cassandra...`);
      let cachedEntries: any[] = [];

      // If refresh is requested, skip cache fetching or invalidate it
      if (refresh && page === 1) {
        sInfo(`[Feed] Forced refresh requested for user ${userId}. Skipping cache.`);
        // Trigger instant recompute in background to update cache for next time
        feedPrecomputeService.triggerPrecompute(userId);
      } else {
        try {
          // Timeout protection for Cassandra to prevent infinite hang
          cachedEntries = await Promise.race([
            cassandraFeedRepo.getCachedUserFeed(userId, 500),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Cassandra Timeout')), 3000))
          ]) as any[];
        } catch (e: any) {
          sError(`[Tracing] Cassandra cache lookup failed: ${e.message}`);
          cachedEntries = [];
        }
      }
      sDebug(`[Tracing] Found ${cachedEntries.length} cached entries.`);

      // Get recent blacklisted (not interested) items
      sDebug(`[Tracing] Fetching interactions...`);
      let recentInteractions: any[] = [];
      try {
        recentInteractions = await Promise.race([
          cassandraFeedRepo.getUserInteractions(userId, 50),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cassandra Timeout')), 2000))
        ]) as any[];
      } catch (e: any) {
        sError(`[Tracing] Interaction lookup failed: ${e.message}`);
        recentInteractions = [];
      }
      const blacklistedIds = new Set(
        recentInteractions
          .filter(i => i.interaction_type === 'not_interested')
          .map(i => String(i.target_id))
      );

      let allPostIds: string[] = [];
      let feedSourceMetadata: Record<string, string> = {};

      // 2. Filter recently seen posts to ensure freshness on refresh
      sDebug(`[Tracing] Fetching seen posts from Redis...`);
      const seenPostIds = await redisService.getSeenPosts(userId);
      sDebug(`[Tracing] Found ${seenPostIds.length} seen posts.`);
      const seenSet = new Set(seenPostIds);

      if (cachedEntries.length > 0) {
        sDebug(`Found ${cachedEntries.length} items in precomputed cache.`);

        // 2. Real-time Injection: Fetch very recent posts from followed users (Freshness)
        // Only do this on page 1 for maximum impact
        let freshPostIds: string[] = [];
        if (page === 1) {
          const freshRes = await pool.query(`
            WITH FreshPosts AS (
              SELECT p.post_id, p.user_id, p.created_at,
                     ROW_NUMBER() OVER (PARTITION BY p.user_id ORDER BY p.created_at DESC) as rn
              FROM posts p
              WHERE EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id)
              AND p.user_id != $1
              AND p.created_at >= NOW() - INTERVAL '30 minutes'
              AND p.is_archived = false AND p.visibility = 'public'
              AND p.status = 'published'
              AND NOT EXISTS (
                SELECT 1 FROM post_media pm 
                JOIN media m ON pm.media_id = m.id 
                WHERE pm.post_id = p.post_id AND m.nsfw_label = ANY($2)
              )
              AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.target_id = p.post_id AND l.user_id = $1)
            )
            SELECT post_id FROM FreshPosts WHERE rn <= 2
            ORDER BY created_at DESC
            LIMIT 10
          `, [userId, unsafeLabels]);
          freshPostIds = freshRes.rows.map(r => String(r.post_id));
          freshPostIds.forEach(id => feedSourceMetadata[id] = 'fresh_following');
        }

        // Combine: Fresh + Cached
        const cachedIds = cachedEntries.map(e => {
          const id = String(e.post_id);
          feedSourceMetadata[id] = e.source;
          return id;
        });

        // Deduplicate and maintain order (Fresh first, then Cached)
        // We filter out seen posts for recommendations, but maybe keep them for followed users if they are very fresh
        const freshSet = new Set(freshPostIds);

        // Strategy: Fresh Followed > Top Suggestions > Random mix of unseen Cached
        const unseenCachedIds = cachedIds.filter(id => !seenSet.has(id) && !freshSet.has(id));

        // Prioritize suggested (similar) posts
        const suggestedIds = unseenCachedIds.filter(id => feedSourceMetadata[id] === 'suggested');
        const otherIds = unseenCachedIds.filter(id => feedSourceMetadata[id] !== 'suggested');

        // Take top 5 similar posts to show at the top
        const topSuggestions = suggestedIds.slice(0, 5);
        const remainingSuggestions = suggestedIds.slice(5);

        // Mix the rest randomly for variety
        const mixedOthers = this.shuffleArray([...otherIds, ...remainingSuggestions]);

        const recommendations = [...topSuggestions, ...mixedOthers];
        const combinedPool = [...new Set([...freshPostIds, ...recommendations])];

        // 1. Filter out blacklisted/not interested items FIRST
        const filteredPool = combinedPool.filter(id => !blacklistedIds.has(id));

        // 2. Apply Diversity Re-ranking to avoid clusters of same author
        allPostIds = await this.diversityReRank(filteredPool);

        // If we ran out of unseen content, mix back some seen content at the very bottom
        if (allPostIds.length < limit && cachedIds.length > 0) {
          const seenCached = cachedIds.filter(id => seenSet.has(id) && !freshSet.has(id) && !blacklistedIds.has(id));
          const mixedSeen = this.shuffleArray(seenCached);
          allPostIds = await this.diversityReRank([...allPostIds, ...mixedSeen]);
        }

        // Background Refresh Trigger: If cache is old or small, trigger recompute
        // For simplicity, we just trigger occasionally or if small
        if (cachedEntries.length < 50) {
          feedPrecomputeService.triggerPrecompute(userId);
        }
      } else {
        sDebug(`Cache miss for user ${userId}.Falling back to synchronous retrieval.`);
        // Fallback: Synchronous 
        const fallbackLimit = 50;
        const fallbackRes = await pool.query(`
          WITH CandidatePosts AS (
            SELECT p.post_id, p.user_id,
                   ROW_NUMBER() OVER (PARTITION BY p.user_id ORDER BY (p.likes_count + p.comments_count * 2) DESC, p.created_at DESC) as rn,
              CASE 
                WHEN EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id) THEN 'following'
                ELSE 'discovery'
            END as source
            FROM posts p
            WHERE(
              EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id)
              OR p.created_at >= NOW() - INTERVAL '7 days'
              OR(p.likes_count + p.comments_count) >= $2
            )
            AND p.user_id != $1
            AND p.post_id != ALL($5) -- Filter out seen posts
            AND p.is_archived = false AND p.visibility = 'public'
            AND p.status = 'published'
            AND NOT EXISTS(
              SELECT 1 FROM post_media pm 
              JOIN media m ON pm.media_id = m.id 
              WHERE pm.post_id = p.post_id AND m.nsfw_label = ANY($4)
            )
            AND NOT EXISTS(SELECT 1 FROM likes l WHERE l.target_id = p.post_id AND l.user_id = $1)
          )
          SELECT post_id, source FROM CandidatePosts
          WHERE rn <= 2
          ORDER BY
            (source = 'following') DESC,
            rn ASC,
            post_id DESC
          LIMIT $3
        `, [userId, MIN_ENGAGEMENT, fallbackLimit, unsafeLabels, seenPostIds]);

        const rawFallbackIds = fallbackRes.rows
          .map(r => {
            const id = String(r.post_id);
            feedSourceMetadata[id] = r.source;
            return id;
          })
          .filter(id => !blacklistedIds.has(id));

        // Apply diversity re-ranking even to fallback to prevent same-author clusters
        allPostIds = await this.diversityReRank(rawFallbackIds);

        sDebug(`Fetched ${allPostIds.length} fresh fallback posts after seen-filtering.`);
        // Trigger background precompute since cache was empty
        feedPrecomputeService.triggerPrecompute(userId);
      }

      // 3. Apply ranking (now handled by Precompute Service)
      let rankedPostIds = allPostIds;
      sDebug(`Feeding ${rankedPostIds.length} pre - ranked posts.`);


      // 4. Pagination Slicing
      const paginatedIds = rankedPostIds.slice(offset, offset + limit);

      if (paginatedIds.length === 0) {
        return { posts: [], hasMore: false };
      }

      // 5. Hydration (PostgreSQL - Meta & Engagement)
      const query = `
          SELECT
          p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
            p.location, p.likes_count:: text as likes_count, p.comments_count:: text as comments_count,
              p.shares_count:: text as shares_count, p.views_count:: text as views_count, p.created_at,
                u.username, u.is_online, up.display_name, up.is_verified, up.bio,
                up.followers_count:: text as followers_count, up.following_count:: text as following_count,
                  EXISTS(SELECT 1 FROM likes WHERE target_type = 'post' AND target_id = p.post_id AND user_id = $1) as user_liked,
                  EXISTS(SELECT 1 FROM saved_posts sp WHERE sp.saved_id = p.post_id AND sp.user_id = $2) as user_saved,
                  EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) as is_following,
                  STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) as hashtags
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        LEFT JOIN post_hashtags ph ON p.post_id = ph.post_id
        LEFT JOIN hashtags h ON ph.hashtag_id = h.hashtag_id
        WHERE p.post_id = ANY($3) AND p.user_id != $1
        GROUP BY p.post_id, u.username, u.is_online, up.display_name, up.is_verified, up.bio, up.followers_count, up.following_count
            `;

      sDebug(`[Tracing] Hydrating ${paginatedIds.length} posts from PG...`);
      const result = await pool.query(query, [userId, userId, paginatedIds]);
      let posts = result.rows;
      sDebug(`[Tracing] Hydrated ${posts.length} posts.`);

      // Maintain the order of IDs we calculated
      const idToIndexMap = new Map(paginatedIds.map((id, index) => [id, index]));
      posts.sort((a, b) => (idToIndexMap.get(a.post_id) ?? 0) - (idToIndexMap.get(b.post_id) ?? 0));

      // 6. Attach Media & Metadata
      if (posts.length > 0) {
        const postIds = posts.map((p: any) => p.post_id);
        const postMediaMap = await mediaRepository.getPostsMedia(postIds);
        const userIds = [...new Set(posts.map((p: any) => p.user_id))];
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        posts.forEach((post: any) => {
          post.user_media = userMediaMap[post.user_id] || [];
          post.profile_picture_url = post.user_media[0]?.file_path || null;
          post.media = postMediaMap[post.post_id] || [];
          post.feed_metadata = {
            source: feedSourceMetadata[post.post_id] || 'unknown',
            is_cached: cachedEntries.length > 0
          };
        });
      }

      const finalPosts: FeedPost[] = toCamel(posts);

      // 7. Asynchronously mark the current page of posts as "seen" 
      // This ensures that when the user refreshes, these posts move to the bottom or disappear
      if (paginatedIds.length > 0) {
        redisService.markPostsAsSeen(userId, paginatedIds, 3600 * 2).catch(e =>
          sError('Failed to mark posts as seen:', e)
        );
      }

      return {
        posts: finalPosts,
        hasMore: offset + finalPosts.length < allPostIds.length
      };

    } catch (error) {
      sError('Error in getFeed:', error);
      throw error;
    }
  }

  async getTrendingPosts(page: number = 1, limit: number = 20, timeRange: '1h' | '6h' | '12h' | '24h' | '7d' | '30d', userId?: string, cursor?: string) {
    try {
      const offset = (page - 1) * Number(limit);
      // Calculate time range
      const timeRangeMap = {
        '1h': 1,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '7d': 24 * 7,
        '30d': 24 * 30
      };
      const hours = timeRangeMap[timeRange] || 24;

      let cursorScore: number | null = null;
      let cursorDate: Date | null = null;
      let refTime: Date = new Date(); // Default to NOW if no cursor

      if (userId && cursor) { // Cursor is optional
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('ascii');
          const parts = decoded.split(',');
          if (parts.length >= 2) {
            cursorScore = parseFloat(parts[0]!);
            cursorDate = new Date(parts[1]!);
            if (parts[2]) {
              refTime = new Date(parts[2]);
            }
          }
        } catch (e) {
          sError('Invalid cursor:', e);
        }
      }

      // Use CTE to materialize score first, then filter by cursor
      // Replaced NOW() with $refTime parameter

      const queryParams: any[] = [];
      let paramIdx = 1;

      let cteSelect = '';
      if (userId) {
        cteSelect = `
          EXISTS(SELECT 1 FROM likes WHERE target_type = 'post' AND target_id = p.post_id AND user_id = $${paramIdx++}) as user_liked,
            EXISTS(SELECT 1 FROM saved_posts WHERE saved_id = p.post_id AND user_id = $${paramIdx++}) as user_saved,
              EXISTS(SELECT 1 FROM follows WHERE follower_id = $${paramIdx++} AND following_id = p.user_id) as is_following,
                `;
        queryParams.push(userId, userId, userId);
      } else {
        // If no user logic needed in select, skipping those params
        cteSelect = 'false as user_liked, false as user_saved, false as is_following,';
      }

      const refTimeParamIdx = paramIdx++;
      queryParams.push(refTime);

      const excludeOwn = userId ? `AND p.user_id != $${paramIdx++} ` : '';
      if (userId) queryParams.push(userId);

      let cursorCondition = 'TRUE';
      // Adjust param indices assuming dynamic construction
      if (cursorScore && cursorDate) {
        cursorCondition = `(trending_score < $${paramIdx++}) OR(trending_score = $${paramIdx - 1} AND created_at < $${paramIdx++})`;
        queryParams.push(cursorScore, cursorDate);
      }

      const limitParamIdx = paramIdx++;
      queryParams.push(Number(limit));

      const finalQuery = `
      WITH scored_posts AS(
                  SELECT 
          p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
                  p.location, p.likes_count, p.comments_count,
                  p.shares_count, p.views_count, p.created_at,
                  u.username, u.is_online, up.display_name, up.is_verified, up.bio,
                  up.followers_count, up.following_count,
                  ${cteSelect}
          --Trending score calculation
                  (
                    (p.likes_count * 1.0) +
                    (p.comments_count * 2.5) +
                    (SELECT COUNT(*) FROM saved_posts WHERE saved_id = p.post_id) * 3.0 +
                (SELECT COUNT(*) FROM shares WHERE post_id = p.post_id) * 4.0
          ) / POWER((EXTRACT(EPOCH FROM ($${refTimeParamIdx} - p.created_at)) / 3600 + 2), 1.5) as trending_score
  
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        
        WHERE p.is_archived = false 
          AND u.account_status = 'active'
          AND p.visibility = 'public'
          AND p.created_at >= $${refTimeParamIdx} - INTERVAL '${hours} hours'
          ${excludeOwn}
AND(p.likes_count + p.comments_count) >= 5
      )
SELECT *,
  (likes_count + comments_count) as total_engagement,
  (likes_count + comments_count):: float / GREATEST(EXTRACT(EPOCH FROM($${refTimeParamIdx} - created_at)) / 3600, 1) as engagement_velocity,
    --Need to re - aggregate hashtags since they weren't in CTE (optimization: fetch hashtags only for result set? Or just allow grouping in CTE)
--To keep logic close to original, let's just fetch hashtags in a separate join or hydrator, but here we can do a subquery or re-join
  (SELECT STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) 
         FROM post_hashtags ph 
         JOIN hashtags h ON ph.hashtag_id = h.hashtag_id 
         WHERE ph.post_id = scored_posts.post_id) as hashtags
      FROM scored_posts
      WHERE ${cursorCondition}
      ORDER BY trending_score DESC, created_at DESC
      LIMIT $${limitParamIdx}
`;

      const result = await pool.query(finalQuery, queryParams);
      const posts = result.rows;

      // Diversity Pass: Avoid clusters of same author
      const reRanked: any[] = [];
      const authorCounts = new Map<string, number>();
      const deferred: any[] = [];
      let lastAuthorId: string | null = null;

      for (const post of posts) {
        const authorId = String(post.user_id);
        const count = authorCounts.get(authorId) || 0;

        if (authorId !== lastAuthorId && count < 2) {
          reRanked.push(post);
          authorCounts.set(authorId, count + 1);
          lastAuthorId = authorId;
        } else {
          deferred.push(post);
        }
      }
      const finalPostsPool = [...reRanked, ...deferred];

      // Handle Next Cursor
      let nextCursor: string | undefined;
      if (finalPostsPool.length === Number(limit)) {
        const lastPost = finalPostsPool[finalPostsPool.length - 1];
        // Include refTime in cursor so next page uses same reference
        const cursorPayload = `${lastPost.trending_score},${lastPost.created_at.toISOString()},${refTime.toISOString()}`;
        nextCursor = Buffer.from(cursorPayload).toString('base64');
      }

      // 6. Attach Media & Metadata
      if (finalPostsPool.length > 0) {
        const postIds = finalPostsPool.map((p: any) => p.post_id);
        const userIds = [...new Set(finalPostsPool.map((p: any) => p.user_id))];
        const postMediaMap = await mediaRepository.getPostsMedia(postIds);
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        finalPostsPool.forEach((post: any) => {
          post.user_media = userMediaMap[post.user_id] || [];
          post.profile_picture_url = post.user_media[0]?.file_path || null;
          post.media = postMediaMap[post.post_id] || [];
          post.feed_metadata = {
            reason: 'trending',
            trending_score: parseFloat(post.trending_score || 0).toFixed(2),
            engagement_velocity: parseFloat(post.engagement_velocity || 0).toFixed(2)
          };
          delete post.trending_score;
          delete post.total_engagement;
          delete post.engagement_velocity;
        });
      }

      const finalPosts = toCamel(finalPostsPool);
      return {
        posts: finalPosts,
        hasMore: finalPostsPool.length >= Number(limit),
        nextCursor
      };

    } catch (error) {
      sError('Error in getTrendingPosts:', error);
      throw error;
    }
  }

  async getTrendingHashtags(limit: number = 20, timeRange: '24h' | '7d' | '30d' = '24h', userId?: string) {
    try {
      const timeRangeMap = {
        '24h': 24,
        '7d': 24 * 7,
        '30d': 24 * 30
      };
      const hours = timeRangeMap[timeRange] || 24;

      const query = `
SELECT
h.hashtag_id,
  h.tag_name,
  h.posts_count:: text as total_posts,
    COUNT(DISTINCT ph.post_id):: text as recent_posts,
      SUM(p.likes_count + p.comments_count):: text as total_engagement,

        --Trending score
          (COUNT(DISTINCT ph.post_id):: float / GREATEST($1, 1)):: text as posts_per_hour,

            --Get sample posts for preview
              (
                SELECT JSON_AGG(
                  JSON_BUILD_OBJECT(
                    'post_id', p2.post_id,
                    'media_url', (
                    SELECT m.original_path
                FROM post_media pm2 
                JOIN media m ON pm2.media_id = m.id
                WHERE pm2.post_id = p2.post_id 
                  AND m.status = 'ready'
                  AND m.deleted_at IS NULL
                ORDER BY pm2.media_order 
                LIMIT 1
                  )
                )
              )
          FROM(
                SELECT p3.post_id 
            FROM posts p3
            JOIN post_hashtags ph3 ON p3.post_id = ph3.post_id
            WHERE ph3.hashtag_id = h.hashtag_id
              AND p3.is_archived = false
              AND p3.visibility = 'public'
            ORDER BY p3.likes_count DESC
            LIMIT 3
              ) p2
) as sample_posts

      FROM hashtags h
      JOIN post_hashtags ph ON h.hashtag_id = ph.hashtag_id
      JOIN posts p ON ph.post_id = p.post_id
      
      WHERE p.created_at >= NOW() - INTERVAL '${hours} hours'
        AND p.is_archived = false
        AND p.visibility = 'public'
      
      GROUP BY h.hashtag_id, h.tag_name, h.posts_count
      HAVING COUNT(DISTINCT ph.post_id) >= 3  -- Minimum 3 posts to be trending
      
      ORDER BY posts_per_hour DESC, total_engagement DESC
      
      LIMIT $2
    `;

      const result = await pool.query(query, [hours, Number(limit)]);
      const hashtags = result.rows;
      const finalHashtags: TrendingHashtagItem[] = toCamel(hashtags);
      return {
        hashtags: finalHashtags,
        hasMore: finalHashtags.length >= Number(limit)
      }
    } catch (error) {
      sError('Error in getTrendingHashtags:', error);
      throw error;
    }
  }

  async getSuggestedPosts(page: number = 1, limit: number = 20, userId: string, SUGGESTION_DAYS: number, MIN_ENGAGEMENT: number, safeMode: number = 1) {
    try {
      const offset = (page - 1) * Number(limit);
      const unsafeLabels = this.getUnsafeLabels(safeMode);

      // Import services dynamically to avoid circular dependencies
      const qdrantService = (await import('../services/QdrantService.js')).default;
      const vectorEmbeddingService = (await import('../services/VectorEmbeddingService.js')).default;
      const cassandraFeedRepo = (await import('./CassandraFeedRepository.js')).default;

      sInfo(`🔍 Getting suggested posts for user ${userId}(page ${page})`);

      // Step 1: Check Cassandra cache first (1-hour TTL)
      if (page === 1) {
        let cachedPosts = await cassandraFeedRepo.getCachedSuggestedPosts(userId, limit);
        cachedPosts = cachedPosts.filter(p => String(p.user_id) !== String(userId));
        if (cachedPosts.length > 0) {
          sInfo(` Returning ${cachedPosts.length} cached suggested posts`);

          // Fetch media from PostgreSQL (still needed for now)
          const postIds = cachedPosts.map((p: any) => p.post_id);
          const userIds = [...new Set(cachedPosts.map((p: any) => p.user_id))];
          const postMediaMap = await mediaRepository.getPostsMedia(postIds);
          const userMediaMap = await mediaRepository.getUsersMedia(userIds);

          cachedPosts.forEach((post: any) => {
            post.userMedia = userMediaMap[post.user_id] || [];
            post.media = postMediaMap[post.post_id] || [];
            post.feed_metadata = {
              reason: post.reason || 'suggested',
              suggestion_score: post.relevance_score?.toFixed(2) || '0.00',
              source: 'cassandra_cache'
            };
            delete post.relevance_score;
            delete post.reason;
          });

          const finalPosts: FeedPost[] = toCamel(cachedPosts);
          return {
            posts: finalPosts,
            hasMore: finalPosts.length >= Number(limit)
          };
        }
      }

      // Step 2: Get user's interaction history to build preference vector
      sDebug('Building user preference profile...');
      const userInteractions = await pool.query(`
        SELECT l.target_id as post_id
        FROM likes l
        WHERE l.user_id = $1 
          AND l.target_type = 'post'
        GROUP BY l.target_id
        ORDER BY MAX(l.created_at) DESC
        LIMIT 20
      `, [userId]);

      const likedPostIds = userInteractions.rows.map(row => row.post_id);

      // Step 3: Get embeddings for user's liked posts and create average preference vector
      let userPreferenceVector: number[] | null = null;

      if (likedPostIds.length > 0) {
        sDebug(`Found ${likedPostIds} liked posts, building preference vector...`);

        // Get media IDs for liked posts (retrieve from Qdrant instead of regenerating)
        const likedPostsMedia = await pool.query(`
          SELECT DISTINCT ON(pm.post_id)
pm.post_id, m.id as media_id, pm.media_order
          FROM post_media pm
          JOIN media m ON pm.media_id = m.id
          WHERE pm.post_id = ANY($1)
            AND m.status = 'ready'
            AND m.deleted_at IS NULL
          ORDER BY pm.post_id, pm.media_order
  `, [likedPostIds]);
        sDebug(`Retrieved ${likedPostsMedia.rows} media IDs for liked posts`);
        // Retrieve existing embeddings from Qdrant (much faster than regenerating!)
        const mediaIds = likedPostsMedia.rows.slice(0, 5).map(row => row.media_id);
        sDebug(`Retrieved ${mediaIds.length} media IDs for liked posts`);
        const vectorMap = await qdrantService.getMediaVectors(mediaIds);
        sDebug(`Retrieved ${vectorMap.size} vectors from Qdrant`);
        const embeddings: number[][] = [];
        for (const [mediaId, vector] of vectorMap.entries()) {
          if (vector && vector.length > 0) {
            embeddings.push(vector);
          }
        }

        sDebug(`Retrieved ${embeddings.length} vectors from Qdrant(no regeneration needed)`);

        // Average the embeddings to create user preference vector
        if (embeddings.length > 0 && embeddings[0]) {
          const vectorSize = embeddings[0].length;
          const userPrefVector = new Array(vectorSize).fill(0);

          for (const embedding of embeddings) {
            if (!embedding) continue;
            for (let i = 0; i < vectorSize; i++) {
              if (embedding[i] !== undefined) {
                userPrefVector[i] += embedding[i];
              }
            }
          }

          // Normalize
          for (let i = 0; i < vectorSize; i++) {
            userPrefVector[i] /= embeddings.length;
          }
          userPreferenceVector = userPrefVector;
          sInfo(` Built user preference vector from ${embeddings.length} posts`);
        }
      }

      // Step 4: Search Qdrant for similar posts
      let candidatePostIds: number[] = [];

      if (userPreferenceVector) {
        sDebug('Searching Qdrant for similar media with safe filters...');
        const similarMedia = await qdrantService.searchSimilarMedia(
          userPreferenceVector,
          limit * 3, // Get more candidates for filtering
          qdrantService.buildSafeFilter(safeMode)
        );

        // Extract post IDs from media results
        const mediaIds = similarMedia.map((result: any) => result.payload?.original_media_id).filter(Boolean);

        if (mediaIds.length > 0) {
          // Map media IDs to post IDs
          const mediaToPostMapping = await pool.query(`
            SELECT DISTINCT pm.post_id, pm.media_id
            FROM post_media pm
            WHERE pm.media_id = ANY($1)
  `, [mediaIds]);

          candidatePostIds = mediaToPostMapping.rows.map(row => row.post_id);
          sInfo(`🎯 Found ${candidatePostIds.length} candidate posts from Qdrant`);
        }
      }

      // Step 5: Fallback to PostgreSQL if no vector results
      if (candidatePostIds.length === 0) {
        sDebug('No Qdrant results, falling back to PostgreSQL...');
        const fallbackQuery = `
          SELECT p.post_id
          FROM posts p
          WHERE p.is_archived = false 
            AND p.visibility = 'public'
            AND p.user_id != $1
            AND NOT EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = p.user_id)
            AND p.created_at >= NOW() - ($3 * INTERVAL '1 day')
            AND p.created_at >= NOW() - ($3 * INTERVAL '1 day')
AND(p.likes_count + p.comments_count) >= $4
            AND NOT EXISTS(
  SELECT 1 FROM post_media pm 
              JOIN media m ON pm.media_id = m.id 
              WHERE pm.post_id = p.post_id AND m.nsfw_label = ANY($6)
)
          ORDER BY(p.likes_count + p.comments_count) DESC
          LIMIT $5
  `;

        const fallbackResult = await pool.query(fallbackQuery, [
          userId, userId, SUGGESTION_DAYS, MIN_ENGAGEMENT, limit * 2, unsafeLabels
        ]);

        candidatePostIds = fallbackResult.rows.map(row => row.post_id);
      }

      // Step 6: Fetch full post details from PostgreSQL (with pagination)
      const paginatedPostIds = candidatePostIds.slice(offset, offset + limit);

      if (paginatedPostIds.length === 0) {
        return { posts: [], hasMore: false };
      }

      const query = `
SELECT
p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
  p.location, p.likes_count:: text as likes_count, p.comments_count:: text as comments_count,
    p.shares_count:: text as shares_count, p.views_count:: text as views_count, p.created_at,
      u.username, u.is_online, up.display_name, up.is_verified, up.bio,
      up.followers_count:: text as followers_count, up.following_count:: text as following_count,
        EXISTS(SELECT 1 FROM likes WHERE target_type = 'post' AND target_id = p.post_id AND user_id = $1) as user_liked,
        EXISTS(SELECT 1 FROM saved_posts WHERE saved_id = p.post_id AND user_id = $2) as user_saved,
        false as is_following,
        STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) as hashtags
        FROM posts p
        JOIN users u ON p.user_id = u.user_id
        JOIN user_profiles up ON u.user_id = up.user_id
        LEFT JOIN post_hashtags ph ON p.post_id = ph.post_id
        LEFT JOIN hashtags h ON ph.hashtag_id = h.hashtag_id
        WHERE p.post_id = ANY($3)
        GROUP BY p.post_id, u.username, u.is_online, up.display_name, up.is_verified, up.bio, up.followers_count, up.following_count
  `;

      const result = await pool.query(query, [userId, userId, paginatedPostIds]);
      const posts = result.rows.filter(p => String(p.user_id) !== String(userId));

      // Step 7: Fetch media
      if (posts.length > 0) {
        const postIds = posts.map((p: any) => p.post_id);
        const userIds = [...new Set(posts.map((p: any) => p.user_id))];
        const postMediaMap = await mediaRepository.getPostsMedia(postIds);
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        posts.forEach((post: any) => {
          post.user_media = userMediaMap[post.user_id] || [];
          post.profile_picture_url = post.user_media[0]?.file_path || null;
          post.media = postMediaMap[post.post_id] || [];
          post.feed_metadata = {
            reason: userPreferenceVector ? 'vector_similarity' : 'trending',
            suggestion_score: '0.85',
            source: userPreferenceVector ? 'qdrant' : 'postgresql'
          };
        });

        // Step 8: Cache results in Cassandra for future requests
        if (page === 1 && posts.length > 0) {
          const postsToCache = posts.map((post: any, index: number) => ({
            post_id: post.post_id,
            user_id: post.user_id,
            username: post.username,
            display_name: post.display_name,
            is_verified: post.is_verified,
            caption: post.caption,
            post_type: post.post_type,
            visibility: post.visibility,
            location: post.location,
            likes_count: post.likes_count,
            comments_count: post.comments_count,
            shares_count: 0,
            created_at: post.created_at,
            hashtags: post.hashtags ? post.hashtags.split(', ') : [],
            has_media: post.media && post.media.length > 0,
            relevance_score: 1.0 - (index * 0.01), // Decreasing score by position
            reason: post.feed_metadata?.reason || 'suggested'
          }));

          // Fire and forget cache update
          cassandraFeedRepo.cacheSuggestedPosts(userId, postsToCache).catch(err =>
            sError('Failed to cache suggested posts:', err)
          );
        }
      }

      const finalPosts: FeedPost[] = toCamel(posts);
      return {
        posts: finalPosts,
        hasMore: offset + finalPosts.length < candidatePostIds.length
      };

    } catch (error) {
      sError('Error in getSuggestedPosts:', error);
      throw error;
    }
  }

  async getPostsByHashtag(hashtag: string, page: number = 1, limit: number = 20, sortBy: 'trending' | 'recent' | 'popular' = 'trending', userId?: string, cursor?: string) {
    try {
      const offset = (page - 1) * Number(limit);
      if (!hashtag) {
        throw new Error('Hashtag parameter is required');
      }

      let cursorScore: number | null = null;
      let cursorDate: Date | null = null;
      let refTime: Date = new Date();

      if (cursor && sortBy === 'trending') {
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('ascii');
          const parts = decoded.split(',');
          if (parts.length >= 2) {
            cursorScore = parseFloat(parts[0]!);
            cursorDate = new Date(parts[1]!);
            if (parts[2]) refTime = new Date(parts[2]);
          }
        } catch (e) {
          sError('getPostsByHashtag: Invalid cursor:', e);
        }
      }

      // Base Sort Options (modified for trending with refTime)
      const sortOptions = {
        trending: `ORDER BY trending_score DESC, p.created_at DESC`,
        recent: 'ORDER BY p.created_at DESC',
        popular: 'ORDER BY (p.likes_count + p.comments_count) DESC'
      };

      const orderBy = sortOptions[sortBy] || sortOptions.trending;

      const queryParams: any[] = [];
      let paramIdx = 1;

      // Conditional subqueries for user context
      let userContextSelect = '';
      if (userId) {
        userContextSelect = `
EXISTS(SELECT 1 FROM likes WHERE target_type = 'post' AND target_id = p.post_id AND user_id = $${paramIdx++}) as user_liked,
  EXISTS(SELECT 1 FROM saved_posts WHERE saved_id = p.post_id AND user_id = $${paramIdx++}) as user_saved,
  EXISTS(SELECT 1 FROM follows WHERE follower_id = $${paramIdx++} AND following_id = p.user_id) as is_following,
  `;
        queryParams.push(userId, userId, userId);
      } else {
        userContextSelect = 'false as user_liked, false as user_saved, false as is_following,';
      }

      queryParams.push(hashtag); // $4 or adjusted
      const hashtagParamIdx = paramIdx++;

      let refTimeParamIdx = 0;
      let trendingScoreCalc = '0 as trending_score'; // Default

      if (sortBy === 'trending') {
        refTimeParamIdx = paramIdx++;
        queryParams.push(refTime);
        trendingScoreCalc = `(p.likes_count + p.comments_count * 2):: float / POWER((EXTRACT(EPOCH FROM($${refTimeParamIdx} - p.created_at)) / 3600 + 2), 1.2) as trending_score`;
      }

      // Cursor filtering logic
      let cursorCondition = 'TRUE';
      if (cursorScore && cursorDate && sortBy === 'trending') {
        cursorCondition = `(
    ((p.likes_count + p.comments_count * 2):: float / POWER((EXTRACT(EPOCH FROM($${refTimeParamIdx} - p.created_at)) / 3600 + 2), 1.2) < $${paramIdx++})
OR
  ((p.likes_count + p.comments_count * 2):: float / POWER((EXTRACT(EPOCH FROM($${refTimeParamIdx} - p.created_at)) / 3600 + 2), 1.2) = $${paramIdx - 1} AND p.created_at < $${paramIdx++})
           )`;
        queryParams.push(cursorScore, cursorDate);
      } else if (page > 1 && !cursor) {
        // Fallback to offset if no cursor (backward compatibility)
        // But wait, if logic is handled by OFFSET clause below?
      }

      const limitParamIdx = paramIdx++;
      queryParams.push(Number(limit));

      let offsetParamIdx = 0;
      if (!cursorScore) {
        offsetParamIdx = paramIdx++;
        queryParams.push(offset);
      }

      let query = `
SELECT
p.post_id, p.user_id, p.caption, p.post_type, p.visibility,
  p.location, p.likes_count:: text as likes_count, p.comments_count:: text as comments_count,
    p.shares_count:: text as shares_count, p.views_count:: text as views_count, p.created_at,
      u.username, up.display_name, up.is_verified,
      ${userContextSelect}
STRING_AGG(DISTINCT h.tag_name, ', ' ORDER BY h.tag_name) as hashtags,
  ${trendingScoreCalc}

      FROM posts p
      JOIN users u ON p.user_id = u.user_id
      JOIN user_profiles up ON u.user_id = up.user_id
      JOIN post_hashtags ph ON p.post_id = ph.post_id
      JOIN hashtags h2 ON ph.hashtag_id = h2.hashtag_id
      LEFT JOIN post_hashtags ph2 ON p.post_id = ph2.post_id
      LEFT JOIN hashtags h ON ph2.hashtag_id = h.hashtag_id
      
      WHERE p.is_archived = false 
        AND u.account_status = 'active'
        AND p.visibility = 'public'
        AND h2.tag_name = $${hashtagParamIdx}
        AND ${cursorScore ? cursorCondition : 'TRUE'}
      
      GROUP BY p.post_id, u.username, up.display_name, up.is_verified
      
      ${orderBy}
      
      LIMIT $${limitParamIdx} ${!cursorScore ? `OFFSET $${offsetParamIdx}` : ''}
`;

      const result = await pool.query(query, queryParams);
      const posts = result.rows;

      // Generate Next Cursor
      let nextCursor: string | undefined;
      if (sortBy === 'trending' && posts.length === Number(limit)) {
        const lastPost = posts[posts.length - 1];
        // Use calculate score or fetched score?
        // If fetched, lastPost.trending_score should be available
        const score = lastPost.trending_score;
        if (score !== undefined) {
          const payload = `${score},${lastPost.created_at.toISOString()},${refTime.toISOString()} `;
          nextCursor = Buffer.from(payload).toString('base64');
        }
      }

      // Fetch media from new media table
      if (posts.length > 0) {
        const postIds = posts.map((p: any) => p.post_id);
        const userIds = [...new Set(posts.map((p: any) => p.user_id))];
        const postMediaMap = await mediaRepository.getPostsMedia(postIds);
        const userMediaMap = await mediaRepository.getUsersMedia(userIds);

        posts.forEach(post => {
          post.user_media = userMediaMap[post.user_id] || [];
          post.profile_picture_url = post.user_media[0]?.file_path || null;
          post.media = postMediaMap[post.post_id] || [];
          post.feed_metadata = {
            reason: 'hashtag',
            hashtag: hashtag,
            trending_score: post.trending_score
          };
          delete post.trending_score; // clean up
        });

      }
      const finalPosts = toCamel(posts);
      sInfo(`Hashtag posts: ${finalPosts.length} (Hashtag: ${hashtag})`);
      return {
        posts: finalPosts,
        hasMore: finalPosts.length >= Number(limit),
        nextCursor
      }

    } catch (error) {
      sError('Error in getPostsByHashtag:', error);
      throw error;
    }
  }

  private getUnsafeLabels(safeMode: number): string[] {
    if (safeMode === 0) return ['sexual', 'suggestive'];
    if (safeMode === 1) return ['sexual'];
    return [];
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i] as T;
      shuffled[i] = shuffled[j] as T;
      shuffled[j] = temp;
    }
    return shuffled;
  }
  private async diversityReRank(postIds: string[]): Promise<string[]> {
    if (postIds.length < 2) return postIds;

    try {
      // Fetch authors for these posts to do re-ranking
      const authorRes = await pool.query('SELECT post_id, user_id FROM posts WHERE post_id = ANY($1)', [postIds]);
      const authorMap = new Map(authorRes.rows.map(r => [String(r.post_id), String(r.user_id)]));

      const result: string[] = [];
      const remaining = [...postIds];
      let lastAuthorId: string | null = null;
      const authorGlobalCount = new Map<string, number>();

      while (remaining.length > 0) {
        let foundIndex = -1;

        // Pass 1: Try to find a post from a different author AND below a saturation limit (max 3 per "page" of IDs)
        for (let i = 0; i < remaining.length; i++) {
          const id = remaining[i]!;
          const authorId = authorMap.get(id);

          if (authorId && authorId !== lastAuthorId) {
            const count = authorGlobalCount.get(authorId) || 0;
            if (count < 3) {
              foundIndex = i;
              break;
            }
          }
        }

        // Pass 2: If Pass 1 failed, just try to different author
        if (foundIndex === -1) {
          for (let i = 0; i < remaining.length; i++) {
            const id = remaining[i]!;
            const authorId = authorMap.get(id);
            if (authorId && authorId !== lastAuthorId) {
              foundIndex = i;
              break;
            }
          }
        }

        // Pass 3: Fallback to any remaining
        if (foundIndex === -1) foundIndex = 0;

        const id = remaining.splice(foundIndex, 1)[0] as string;
        const currentAuthorId = authorMap.get(id) || null;

        result.push(id);
        lastAuthorId = currentAuthorId;
        if (currentAuthorId) {
          authorGlobalCount.set(currentAuthorId, (authorGlobalCount.get(currentAuthorId) || 0) + 1);
        }
      }

      return result;
    } catch (error) {
      sError('Error in diversityReRank:', error);
      return postIds; // Fallback to original order on error
    }
  }

}
const feedRepository = new FeedRepository();
export default feedRepository;