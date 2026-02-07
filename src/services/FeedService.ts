import feedRepository from "../repositories/FeedRepository.js";
import getFeedConfigCached from "../config/feed.config.js";
import { FEED_CONFIG } from "../config/feed.config.js";
import { sError, sLog } from "sk-logger";
const { DEFAULT_PAGE_SIZE, SIMILARITY_WEIGHT, ENGAGEMENT_WEIGHT, POPULARITY_WEIGHT } = FEED_CONFIG;
class FeedService {
    async getFeed(page = DEFAULT_PAGE_SIZE, limit = 20, userId: string, safeMode?: number, refresh: boolean = false) {
        try {
            const { SUGGESTION_DAYS = 7, MIN_ENGAGEMENT = 5 } = await getFeedConfigCached();

            // If safeMode is not provided, fetch from user's preference in DB
            if (safeMode === undefined) {
                const userRepository = (await import('../repositories/UserRepository.js')).default;
                safeMode = await userRepository.getUserSafeMode(userId);
            }

            sLog(`User ${userId} Feed Request - SafeMode: ${safeMode}, Refresh: ${refresh}`);
            return await feedRepository.getFeed(page, limit, userId, MIN_ENGAGEMENT as number, safeMode, refresh);
        } catch (error) {
            sError('FeedService Error:', error);
            throw new Error('Failed to load feed'); // propagate a friendly error
        }
    }
    async getTrendingPosts(page = DEFAULT_PAGE_SIZE, limit = 20, timeRange: '1h' | '6h' | '12h' | '24h' | '7d' | '30d' = "7d", userId: string, cursor?: string) {
        try {
            const { SUGGESTION_DAYS, MIN_ENGAGEMENT } = await getFeedConfigCached();

            return await feedRepository.getTrendingPosts(page, limit, timeRange, userId, cursor);
        } catch (error) {
            sError('FeedService Error:', error);
            throw new Error('Failed to load feed'); // propagate a friendly error
        }
    }
    async getTrendingHashtags(limit = 20, timeRange: "24h" | "7d" | "30d" = '7d', userId: string) {
        try {
            return await feedRepository.getTrendingHashtags(limit, timeRange, userId);
        } catch (error) {
            sError('FeedService Error:', error);
            throw new Error('Failed to load feed'); // propagate a friendly error
        }
    }
    async getSuggestedPosts(page = DEFAULT_PAGE_SIZE, limit = 20, userId: string, safeMode?: number) {
        try {
            const { SUGGESTION_DAYS = 7, MIN_ENGAGEMENT = 5 } = await getFeedConfigCached();

            // If safeMode is not provided, fetch from user's preference in DB
            if (safeMode === undefined) {
                const userRepository = (await import('../repositories/UserRepository.js')).default;
                safeMode = await userRepository.getUserSafeMode(userId);
            }

            return await feedRepository.getSuggestedPosts(page, limit, userId, SUGGESTION_DAYS as number, MIN_ENGAGEMENT as number, safeMode);
        } catch (error) {
            sError('FeedService Error:', error);
            throw new Error('Failed to load feed'); // propagate a friendly error
        }

    }
    async getPostsByHashtag(hashtag: string, page = DEFAULT_PAGE_SIZE, limit = 20, sortBy: "trending" | "recent" | "popular" | undefined = 'trending', userId: string, cursor?: string) {
        try {
            return await feedRepository.getPostsByHashtag(hashtag, page, limit, sortBy, userId, cursor);
        } catch (error) {
            sError('FeedService Error:', error);
            throw new Error('Failed to load feed'); // propagate a friendly error
        }
    }
}
export default new FeedService();