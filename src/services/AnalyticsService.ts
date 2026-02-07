import redisService from '../cache/RedisService.js';
import analyticsRepository from '../repositories/AnalyticsRepository.js';
import { sError, sInfo } from 'sk-logger';

class AnalyticsService {
    /**
     * Entry point for profile visits
     */
    async trackProfileVisit(profileId: string, userId: string) {
        try {
            // Redis handles deduplication and streaming
            await redisService.recordProfileVisit(profileId, userId);
        } catch (err) {
            sError('Track profile visit failed:', err);
        }
    }

    /**
     * Entry point for watch time heartbeats
     */
    async trackWatchHeartbeat(contentId: string, userId: string, duration: number, deviceType: string = 'web') {
        try {
            await redisService.streamWatchHeartbeat(contentId, userId, duration, deviceType);
        } catch (err) {
            sError('Track watch heartbeat failed:', err);
        }
    }

    /**
     * Entry point for various heartbeats (app navigation, content watching)
     */
    async trackHeartbeat(userId: string, type: 'active_time' | 'watch_time', duration: number) {
        try {
            await analyticsRepository.incrementUsageMetric(userId, type, duration);
        } catch (err) {
            sError('Track heartbeat failed:', err);
        }
    }

    /**
     * Get usage metrics for today
     */
    async getUserUsage(userId: string) {
        try {
            const today = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
            const stats = await analyticsRepository.getUserUsageStats(userId, today);

            const result = {
                activeTime: 0,
                watchTime: 0
            };

            stats.forEach((row: any) => {
                if (row.metric_type === 'active_time') result.activeTime = parseInt(row.total_seconds.toString());
                if (row.metric_type === 'watch_time') result.watchTime = parseInt(row.total_seconds.toString());
            });

            return result;
        } catch (err) {
            sError('Error getting user usage:', err);
            return { activeTime: 0, watchTime: 0 };
        }
    }

    /**
     * Fetch aggregated profile metrics
     */
    async getProfileStats(userId: string, days: number = 7) {
        try {
            const end = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            const start = parseInt(startDate.toISOString().slice(0, 10).replace(/-/g, ''));

            const metrics = await analyticsRepository.getProfileMetrics(userId, start, end);

            // Format for charts
            return metrics.reduce((acc: any, row: any) => {
                const day = row.day_bucket;
                if (!acc[day]) acc[day] = {};
                acc[day][row.metric_type] = row.count.toString(); // Cassandra counters are Long
                return acc;
            }, {});
        } catch (err) {
            sError('Error getting profile stats:', err);
            return {};
        }
    }
}

export default new AnalyticsService();
