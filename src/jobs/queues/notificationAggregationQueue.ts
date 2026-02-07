import { Queue } from 'bullmq';
import { redisConnection } from '../index.js';

const connection = redisConnection();

class NotificationAggregationQueue {
    private queue: Queue;

    constructor() {
        this.queue = new Queue('notificationAggregationQueue', { connection });
        this.setupRepeatingJobs();
    }

    setupRepeatingJobs() {
        // Process aggregations every 10 seconds (configurable)
        this.queue.add(
            'aggregate-notifications',
            {},
            {
                repeat: {
                    every: 10000 // 10 seconds
                },
                jobId: 'recurring-notification-aggregator'
            }
        );
    }

    getQueue() {
        return this.queue;
    }
}

export default new NotificationAggregationQueue();
