import cassandraClient from '../config/cassandra.config.js';
import { sDebug, sError, sInfo } from 'sk-logger';

interface CassandraPost {
    post_id: string;
    user_id: string;
    username?: string;
    display_name?: string;
    is_verified?: boolean;
    caption: string;
    post_type: string;
    visibility: string;
    location?: string;
    likes_count: number;
    comments_count: number;
    shares_count: number;
    created_at: Date;
    hashtags?: string[];
    has_media?: boolean;
}

interface SuggestedPost extends CassandraPost {
    relevance_score: number;
    reason: string;
}

interface FeedCacheEntry {
    post_id: string;
    score: number;
    source: 'following' | 'suggested' | 'trending' | 'discovery';
    created_at: Date;
}

class CassandraFeedRepository {

    /**
     * Get post metadata by IDs from Cassandra
     */
    async getPostsByIds(postIds: string[]): Promise<CassandraPost[]> {
        try {
            if (postIds.length === 0) return [];

            const query = 'SELECT * FROM post_metadata WHERE post_id IN ?';
            const result = await cassandraClient.execute(query, [postIds], { prepare: true });

            return result.rows.map(row => ({
                post_id: row.post_id,
                user_id: row.user_id,
                username: row.username,
                display_name: row.display_name,
                is_verified: row.is_verified,
                caption: row.caption,
                post_type: row.post_type,
                visibility: row.visibility,
                location: row.location,
                likes_count: row.likes_count,
                comments_count: row.comments_count,
                shares_count: row.shares_count,
                created_at: row.created_at,
                hashtags: row.hashtags || [],
                has_media: row.has_media
            }));
        } catch (error) {
            sError('Error fetching posts from Cassandra:', error);
            return [];
        }
    }

    /**
     * Cache suggested posts for a user
     */
    async cacheSuggestedPosts(userId: string, posts: SuggestedPost[]): Promise<void> {
        try {
            const query = `
                INSERT INTO suggested_posts_cache 
                (user_id, post_id, relevance_score, reason, cached_at) 
                VALUES (?, ?, ?, ?, ?)
            `;

            const batch = posts.map(post => ({
                query,
                params: [
                    userId,
                    post.post_id,
                    post.relevance_score,
                    post.reason,
                    new Date()
                ]
            }));

            await cassandraClient.batch(batch, { prepare: true });
            sDebug(`Cached ${posts.length} suggested posts for user ${userId}`);
        } catch (error) {
            sError('Error caching suggested posts:', error);
        }
    }

    /**
     * Get cached suggested posts for a user
     */
    async getCachedSuggestedPosts(userId: string, limit: number = 20): Promise<SuggestedPost[]> {
        try {
            const query = `
                SELECT * FROM suggested_posts_cache 
                WHERE user_id = ? 
                LIMIT ?
            `;

            const result = await cassandraClient.execute(query, [userId, limit], { prepare: true });

            if (result.rows.length === 0) {
                return [];
            }

            // Get full post details
            const postIds = result.rows.map(row => row.post_id);
            const posts = await this.getPostsByIds(postIds);

            // Merge with cache metadata
            return result.rows.map(cacheRow => {
                const post = posts.find(p => p.post_id === cacheRow.post_id);
                return post ? {
                    ...post,
                    relevance_score: cacheRow.relevance_score,
                    reason: cacheRow.reason
                } : null;
            }).filter(p => p !== null) as SuggestedPost[];

        } catch (error) {
            sError('Error getting cached suggested posts:', error);
            return [];
        }
    }

    /**
     * Store user interaction for future recommendations
     */
    async recordUserInteraction(
        userId: string,
        targetId: string | number,
        targetType: 'post' | 'reel' | 'story',
        interactionType: 'like' | 'comment' | 'save' | 'share' | 'interested' | 'not_interested'
    ): Promise<void> {
        try {
            const query = `
                INSERT INTO user_interactions 
                (user_id, target_id, target_type, interaction_type, created_at) 
                VALUES (?, ?, ?, ?, ?)
            `;

            await cassandraClient.execute(query, [
                userId,
                targetId,
                targetType,
                interactionType,
                new Date()
            ], { prepare: true });

        } catch (error) {
            sError('Error recording user interaction:', error);
        }
    }

    /**
     * Get user's recent interactions for building preference profile
     */
    async getUserInteractions(userId: string, limit: number = 100): Promise<any[]> {
        try {
            const query = `
                SELECT * FROM user_interactions 
                WHERE user_id = ? 
                LIMIT ?
            `;

            const result = await cassandraClient.execute(query, [userId, limit], { prepare: true });
            return result.rows;

        } catch (error) {
            sError('Error getting user interactions:', error);
            return [];
        }
    }

    /**
     * Cache the full feed for a user
     */
    async cacheUserFeed(userId: string, entries: FeedCacheEntry[]): Promise<void> {
        try {
            const query = `
                INSERT INTO user_feed_cache 
                (user_id, post_id, score, source, created_at, cached_at) 
                VALUES (?, ?, ?, ?, ?, ?)
                USING TTL 3600
            `;

            const batch = entries.map(entry => ({
                query,
                params: [
                    userId,
                    entry.post_id,
                    entry.score,
                    entry.source,
                    entry.created_at,
                    new Date()
                ]
            }));

            await cassandraClient.batch(batch, { prepare: true });
            sDebug(`Cached ${entries.length} feed items for user ${userId} (TTL: 1h)`);
        } catch (error) {
            sError('Error caching user feed:', error);
        }
    }

    /**
     * Get precomputed feed from cache
     */
    async getCachedUserFeed(userId: string, limit: number = 50): Promise<FeedCacheEntry[]> {
        try {
            const query = `
                SELECT post_id, score, source, created_at FROM user_feed_cache 
                WHERE user_id = ? 
                LIMIT ?
            `;

            const result = await cassandraClient.execute(query, [userId, limit], { prepare: true });

            return result.rows.map(row => ({
                post_id: row.post_id,
                score: row.score,
                source: row.source,
                created_at: row.created_at
            }));
        } catch (error) {
            sError('Error getting cached user feed:', error);
            return [];
        }
    }

    /**
     * Get full post details from metadata table for a set of IDs
     */
    async getFeedPostsMetadata(postIds: string[]): Promise<CassandraPost[]> {
        return this.getPostsByIds(postIds);
    }

    /**
     * Upsert post metadata to Cassandra
     */
    async upsertPostMetadata(post: CassandraPost): Promise<void> {
        try {
            const query = `
                INSERT INTO post_metadata 
                (post_id, user_id, username, display_name, is_verified, caption, 
                 post_type, visibility, location, likes_count, comments_count, 
                 shares_count, created_at, hashtags, has_media) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            await cassandraClient.execute(query, [
                post.post_id,
                post.user_id,
                post.username,
                post.display_name,
                post.is_verified,
                post.caption,
                post.post_type,
                post.visibility,
                post.location,
                post.likes_count,
                post.comments_count,
                post.shares_count,
                post.created_at,
                post.hashtags || [],
                post.has_media
            ], { prepare: true });

        } catch (error) {
            sError('Error upserting post metadata:', error);
        }
    }

    /**
     * Delete post metadata from Cassandra
     */
    async deletePostMetadata(postId: string): Promise<void> {
        try {
            const query = 'DELETE FROM post_metadata WHERE post_id = ?';
            await cassandraClient.execute(query, [postId], { prepare: true });
            sDebug(`Deleted Cassandra metadata for post: ${postId}`);
        } catch (error) {
            sError(`Error deleting Cassandra metadata for post ${postId}:`, error);
        }
    }

    async deleteUserFeedCache(userId: string): Promise<void> {
        try {
            const query = 'DELETE FROM user_feed_cache WHERE user_id = ?';
            await cassandraClient.execute(query, [userId], { prepare: true });

            const suggestionQuery = 'DELETE FROM suggested_posts_cache WHERE user_id = ?';
            await cassandraClient.execute(suggestionQuery, [userId], { prepare: true });
            sDebug(`Deleted feed caches for user ${userId}`);
        } catch (error) {
            sError(`Error deleting feed cache for user ${userId}:`, error);
        }
    }

    /**
     * Clear all feed and suggestion cache entries (Admin/Debug)
     */
    async truncateFeedCaches(): Promise<void> {
        try {
            await cassandraClient.execute('TRUNCATE post_metadata');
            await cassandraClient.execute('TRUNCATE user_feed_cache');
            await cassandraClient.execute('TRUNCATE suggested_posts_cache');
            sInfo('Truncated all post-related tables in Cassandra.');
        } catch (error) {
            sError('Error truncating Cassandra tables:', error);
        }
    }
}

export default new CassandraFeedRepository();
