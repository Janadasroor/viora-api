import cassandraClient from '../config/cassandra.config.js';
import { sDebug, sError } from 'sk-logger';

export interface ReelViewLog {
    reelId: string;
    userId: string;
    watchTime: number;
    duration: number;
    viewedAt: Date;
}

class CassandraReelViewsRepository {
    /**
     * Record a single reel view log in Cassandra
     */
    async recordReelView(log: ReelViewLog): Promise<void> {
        try {
            const query = `
                INSERT INTO reel_views 
                (reel_id, user_id, watch_time, duration, viewed_at) 
                VALUES (?, ?, ?, ?, ?)
            `;

            await cassandraClient.execute(query, [
                log.reelId,
                log.userId,
                log.watchTime,
                log.duration,
                log.viewedAt
            ], { prepare: true });

        } catch (error) {
            sError('Error recording reel view in Cassandra:', error);
        }
    }

    /**
     * Batch insert reel view logs into Cassandra
     */
    async batchInsertReelViews(logs: ReelViewLog[]): Promise<void> {
        try {
            if (logs.length === 0) return;

            const query = `
                INSERT INTO reel_views 
                (reel_id, user_id, watch_time, duration, viewed_at) 
                VALUES (?, ?, ?, ?, ?)
            `;

            const batch = logs.map(log => ({
                query,
                params: [
                    log.reelId,
                    log.userId,
                    log.watchTime,
                    log.duration,
                    log.viewedAt
                ]
            }));

            sDebug(`Attempting to batch insert ${logs.length} reel views to Cassandra`);
            await cassandraClient.batch(batch, { prepare: true });
            sDebug(` Successfully batch inserted ${logs.length} reel views to Cassandra`);
        } catch (error) {
            sError('Error batch inserting reel views to Cassandra:', error);
        }
    }
}

export default new CassandraReelViewsRepository();
