import cassandraClient from '../config/cassandra.config.js';
import { sError, sDebug } from 'sk-logger';

class AnalyticsRepository {
    /**
     * Increment daily profile metrics (visits, follows, etc)
     */
    async incrementProfileMetric(userId: string | number, metricType: string, count: number = 1) {
        const dayBucket = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
        const query = `
            UPDATE profile_daily_metrics 
            SET count = count + ? 
            WHERE profile_id = ? AND day_bucket = ? AND metric_type = ?
        `;
        try {
            await cassandraClient.execute(query, [count, userId, dayBucket, metricType], { prepare: true });
        } catch (err) {
            sError('Error incrementing profile metric:', err);
            throw err;
        }
    }

    /**
     * Batch insert watch retention heartbeats
     */
    async batchInsertWatchRetention(logs: any[]) {
        const queries = logs.map(log => ({
            query: `
                INSERT INTO content_watch_retention (content_id, ts, user_id, duration, device_type)
                VALUES (?, ?, ?, ?, ?)
            `,
            params: [log.contentId, log.ts, log.userId, log.duration, log.deviceType]
        }));

        try {
            await cassandraClient.batch(queries, { prepare: true });
            sDebug(`Successfully batched ${logs.length} watch logs to Cassandra`);
        } catch (err) {
            sError('Error batch inserting watch retention:', err);
            throw err;
        }
    }

    /**
     * Increment content performance totals
     */
    async incrementContentPerformance(contentId: string, metrics: { watchTime?: number, views?: number, shares?: number }) {
        const updates: string[] = [];
        const params: any[] = [];

        if (metrics.watchTime) {
            updates.push('total_watch_time = total_watch_time + ?');
            params.push(metrics.watchTime);
        }
        if (metrics.views) {
            updates.push('total_views = total_views + ?');
            params.push(metrics.views);
        }
        if (metrics.shares) {
            updates.push('total_shares = total_shares + ?');
            params.push(metrics.shares);
        }

        if (updates.length === 0) return;

        params.push(contentId);
        const query = `UPDATE content_performance_totals SET ${updates.join(', ')} WHERE content_id = ?`;

        try {
            await cassandraClient.execute(query, params, { prepare: true });
        } catch (err) {
            sError('Error updating content performance:', err);
            throw err;
        }
    }

    /**
     * Get profile metrics for a date range
     */
    async getProfileMetrics(userId: string, startDay: number, endDay: number) {
        const query = `
            SELECT day_bucket, metric_type, count 
            FROM profile_daily_metrics 
            WHERE profile_id = ? AND day_bucket >= ? AND day_bucket <= ?
        `;
        try {
            const result = await cassandraClient.execute(query, [userId, startDay, endDay], { prepare: true });
            return result.rows;
        } catch (err) {
            sError('Error fetching profile metrics:', err);
            throw err;
        }
    }

    /**
     * Increment specific usage metrics (active_time, watch_time)
     */
    async incrementUsageMetric(userId: string | number, metricType: 'active_time' | 'watch_time', seconds: number) {
        const dayBucket = parseInt(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
        const query = `
            UPDATE user_daily_usage
            SET total_seconds = total_seconds + ?
            WHERE user_id = ? AND day_bucket = ? AND metric_type = ?
        `;
        try {
            await cassandraClient.execute(query, [seconds, userId, dayBucket, metricType], { prepare: true });
        } catch (err) {
            sError('Error incrementing usage metric:', err);
            throw err;
        }
    }

    /**
     * Get aggregated usage stats for a user
     */
    async getUserUsageStats(userId: string | number, dayBucket: number) {
        const query = `
            SELECT metric_type, total_seconds 
            FROM user_daily_usage 
            WHERE user_id = ? AND day_bucket = ?
        `;
        try {
            const result = await cassandraClient.execute(query, [userId, dayBucket], { prepare: true });
            return result.rows;
        } catch (err) {
            sError('Error fetching user usage stats:', err);
            throw err;
        }
    }
}

export default new AnalyticsRepository();
