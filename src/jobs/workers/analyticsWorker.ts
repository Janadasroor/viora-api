import { Worker } from 'bullmq';
import redisService from '../../cache/RedisService.js';
import analyticsRepository from '../../repositories/AnalyticsRepository.js';
import { redisConnection } from "../index.js";
import { sDebug, sError, sInfo } from 'sk-logger';

const connection = redisConnection();

async function processAnalyticsBatch() {
    sDebug('Starting Analytics batch processing...');
    // 1. Process Profile Events (Visits, etc.)
    let events = await redisService.getPendingAnalyticsEvents('analytics:events', 500);
    if (events.length > 0) sInfo(`Found ${events.length} pending analytics events`);
    while (events.length > 0) {
        const messageIds = events.map((e: any) => e.id);

        // Group by profile and type for atomic increments
        const profileAggregates = new Map<string, Map<string, number>>();

        for (const event of events) {
            const { type, profileId } = event.data;
            if (!profileId) continue;

            if (!profileAggregates.has(profileId)) profileAggregates.set(profileId, new Map());
            const typeMap = profileAggregates.get(profileId)!;
            typeMap.set(type, (typeMap.get(type) || 0) + 1);
        }

        // Apply Increments to Cassandra
        for (const [profileId, typeMap] of profileAggregates) {
            for (const [type, count] of typeMap) {
                await analyticsRepository.incrementProfileMetric(profileId, type, count);
            }
        }

        await redisService.ackAnalyticsEvents('analytics:events', messageIds);
        events = await redisService.getPendingAnalyticsEvents('analytics:events', 500);
    }

    // 2. Process Watch Streams
    let watchLogs = await redisService.getPendingAnalyticsEvents('analytics:watch_streams', 500);
    if (watchLogs.length > 0) sInfo(`Found ${watchLogs.length} pending watch stream logs`);
    while (watchLogs.length > 0) {
        const messageIds = watchLogs.map((e: any) => e.id);

        const logs = watchLogs.map((e: any) => ({
            contentId: e.data.contentId,
            userId: e.data.userId,
            duration: parseInt(e.data.duration),
            deviceType: e.data.deviceType,
            ts: new Date(parseInt(e.data.ts))
        }));

        // Insert granular time-series (with TTL in repository if added)
        await analyticsRepository.batchInsertWatchRetention(logs);

        // Update performance totals
        const contentAggregates = new Map<string, number>();
        for (const log of logs) {
            contentAggregates.set(log.contentId, (contentAggregates.get(log.contentId) || 0) + log.duration);
        }

        for (const [contentId, totalDuration] of contentAggregates) {
            await analyticsRepository.incrementContentPerformance(contentId, { watchTime: totalDuration, views: 1 });
        }

        await redisService.ackAnalyticsEvents('analytics:watch_streams', messageIds);
        watchLogs = await redisService.getPendingAnalyticsEvents('analytics:watch_streams', 500);
    }
}

const analyticsWorker = new Worker(
    'analyticsQueue',
    async (job) => {
        if (job.name === 'aggregate-analytics') {
            await processAnalyticsBatch();
        }
    },
    { connection, concurrency: 1 }
);

analyticsWorker.on('completed', (job) => {
    sDebug('Analytics aggregation job completed');
});

analyticsWorker.on('failed', (job, err) => {
    sError('Analytics aggregation job failed', err);
});

export default analyticsWorker;
