import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
const connection = redisConnection();

class StoryViewsQueue {
    private queue: Queue;
    constructor() {
        this.queue = new Queue('storyViewsQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    setupRepeatingJobs() {
        // Run every 5 seconds to process buffered story views
        this.queue.add(
            'batch-process-all-story-views',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-story-view-processor'
            }
        );
    }
}

const storyViewsQueue = new StoryViewsQueue();
export default storyViewsQueue;
