import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";

const connection = redisConnection();
const analyticsQueue = new Queue('analyticsQueue', { connection });

class AnalyticsQueue {
    private queue: Queue;
    constructor() {
        this.queue = new Queue('analyticsQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    async setupRepeatingJobs() {
        // Run aggregation every 10 seconds
        await this.queue.add(
            'aggregate-analytics',
            {},
            {
                repeat: { every: 10000 },
                jobId: 'recurring-analytics-aggregator',
            }
        );
    }
}

const analyticsQueueInstance = new AnalyticsQueue();
export default analyticsQueueInstance;
