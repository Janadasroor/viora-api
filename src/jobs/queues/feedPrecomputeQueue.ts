import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";

const connection = redisConnection();

export const feedPrecomputeQueue = new Queue('feedPrecomputeQueue', {
    connection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

export const addFeedPrecomputeJob = async (userId: string) => {
    return await feedPrecomputeQueue.add('feed-precompute', { userId }, {
        // Use userId as jobId to prevent duplicate pending jobs for the same user
        jobId: `precompute-${userId}`
    });
};
