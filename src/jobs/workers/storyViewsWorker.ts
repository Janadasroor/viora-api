import { Worker } from 'bullmq';
import { redisConnection } from "../index.js";
import redisService from '../../cache/RedisService.js';
import storiesRepository from '../../repositories/StoriesRepository.js';
import { sDebug, sError } from 'sk-logger';

const connection = redisConnection();

async function processStoryViews(job: any) {
    if (job.name === 'batch-process-all-story-views') {
        const storyIds = await redisService.getAllStoriesWithPendingViews();
        if (!storyIds || storyIds.length === 0) return;

        sDebug(` Processing pending views for ${storyIds.length} stories...`);

        for (const storyId of storyIds) {
            try {
                const userIds = await redisService.getAccumulatedViews(storyId);
                if (userIds.length > 0) {
                    const views = userIds.map(userId => ({ storyId, userId }));
                    await storiesRepository.bulkInsertStoryViews(views);
                    await storiesRepository.syncStoryViewCounts(storyId);
                    await redisService.clearViewBuffer(storyId);
                }
            } catch (err) {
                sError(`Error processing views for story ${storyId}:`, err);
            }
        }
    }
}

const storyViewsWorker = new Worker(
    'storyViewsQueue',
    processStoryViews,
    { connection, concurrency: 5 }
);

storyViewsWorker.on('completed', () => {
    sDebug(' Story views batch processing completed');
});

storyViewsWorker.on('failed', (job, err) => {
    sError(' Story views batch processing failed:', err);
});

export default storyViewsWorker;
