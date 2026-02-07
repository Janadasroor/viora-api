import { Worker } from 'bullmq';
import { redisConnection } from "../index.js";
import feedPrecomputeService from '../../services/FeedPrecomputeService.js';
import { sDebug, sError, sInfo } from 'sk-logger';

const connection = redisConnection();

const feedPrecomputeWorker = new Worker(
    'feedPrecomputeQueue',
    async (job) => {
        if (job.name === 'feed-precompute') {
            const { userId } = job.data;
            sInfo(`[Worker] Starting feed precomputation for user ${userId}`);

            try {
                // Call the actual precomputation logic
                // Pass true to internal call if needed, but the service method handles it
                await feedPrecomputeService.precomputeUserFeed(userId);
                sInfo(`[Worker] ✓ Successfully precomputed feed for user ${userId}`);
            } catch (error) {
                sError(`[Worker] ✗ Failed precompute for user ${userId}:`, error);
                throw error; // BullMQ retry
            }
        }
    },
    {
        connection,
        concurrency: 2, // Limit concurrent precomputations to avoid overwhelming DB/Qdrant
    }
);

feedPrecomputeWorker.on('completed', (job) => {
    sDebug(`[Worker] Feed job ${job.id} completed`);
});

feedPrecomputeWorker.on('failed', (job, err) => {
    sError(`[Worker] Feed job ${job?.id} failed:`, err);
});

export default feedPrecomputeWorker;
