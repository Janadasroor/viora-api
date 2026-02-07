import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";

const connection = redisConnection();
const reelViewsQueue = new Queue('reelViewsQueue', { connection });

class ReelViewsQueue {
    constructor(){this.setupRepeatingJobs();}

    setupRepeatingJobs() {
        reelViewsQueue.add(
            'batch-process-all-reel-views',
            {},
            {
                repeat: { every: 5000 },
                jobId: 'recurring-reel-processor',
            }
        );
    }

    async addBatchJob(reelId: string | number, options: { priority?: number } = {}) {
        const { priority = 10 } = options;
        await reelViewsQueue.add(
            'batch-process-reel-views',
            { reelId },
            {
                priority,
                jobId: `batch:${reelId}:${Date.now()}`,
                removeOnComplete: true,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
            }
        );
    }
}

const reelViewsQueueInstance = new ReelViewsQueue();
export default reelViewsQueueInstance;
