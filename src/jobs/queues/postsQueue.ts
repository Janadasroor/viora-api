import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";

const connection = redisConnection();

export const postsQueue = new Queue('postsQueue', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

export const addPostProcessingJob = async (data: { postId: string; caption: string; userId: string }) => {
    return await postsQueue.add('post-processing', data);
};
