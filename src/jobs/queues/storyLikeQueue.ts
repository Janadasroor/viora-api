import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";

const connection = redisConnection();

class StoryLikeQueue {
    private queue: Queue;

    constructor() {
        this.queue = new Queue('storyLikeQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    setupRepeatingJobs() {
        // Process ALL stories with pending likes every 5 seconds
        this.queue.add(
            'batch-process-all-story-likes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-story-like-processor' // Prevent duplicates
            }
        );

        // Process ALL pending story unlikes every 5 seconds
        this.queue.add(
            'batch-process-all-story-unlikes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-story-unlike-processor' // Prevent duplicates
            }
        );
    }

    async addBatchJob(storyId: string | number, options: { priority?: number } = {}) {
        const { priority = 10 } = options; // Default priority: 10 (lower number = higher priority)

        await this.queue.add(
            'batch-process-story-likes',
            { storyId },
            {
                priority, // 1 = highest priority (viral stories)
                jobId: `batch:${storyId}:${Date.now()}`, // Unique ID with timestamp
                removeOnComplete: true,
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000
                }
            }
        );
    }
}

const storyLikeQueue = new StoryLikeQueue();
export default storyLikeQueue;
