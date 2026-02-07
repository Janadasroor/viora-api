import { Worker } from 'bullmq';
import { redisConnection } from '../index.js';
import notificationAggregationQueue from '../queues/notificationAggregationQueue.js';
import { sDebug, sError } from 'sk-logger';
import notificationsService from '../../services/NotificationsService.js';

const connection = redisConnection();

async function processAggregation(job: any) {
    if (job.name === 'aggregate-notifications') {
        sDebug(' Processing notification aggregations...');
        const redisService = (await import('../../cache/RedisService.js')).default;
        const batches = await redisService.getPendingNotificationAggregations();

        sDebug(`Found ${batches.length} aggregation batches to process`);

        for (const batch of batches) {
            await notificationsService.processAggregationBatch(batch);
        }
    }
}


const worker = new Worker(
    'notificationAggregationQueue',
    processAggregation,
    { connection }
);

worker.on('completed', (job) => {
    sDebug(' Notification aggregation job completed');
});

worker.on('failed', (job, err) => {
    sError(' Notification aggregation job failed:', err);
});

// Log worker startup
sDebug(' Notification Aggregation Worker started');
sDebug(' Queue initialized with 10-second recurring job');

export { worker };
