import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
const connection = redisConnection();
class LikeQueue {
    private queue: Queue;
    constructor() {
        this.queue = new Queue('likeQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    setupRepeatingJobs() {
        // Process ALL posts with pending likes every 5 seconds
        this.queue.add(
            'batch-process-all-likes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-like-processor' // Prevent duplicates
            }
        );

        // Process ALL pending unlikes every 5 seconds
        this.queue.add(
            'batch-process-all-unlikes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-unlike-processor' // Prevent duplicates
            }
        );
    }

    async addBatchJob(postId: string | number, options: { priority?: number } = {}) {
        const { priority = 10 } = options; // Default priority: 10 (lower number = higher priority)

        await this.queue.add(
            'batch-process-likes',
            { postId },
            {
                priority, // 1 = highest priority (viral posts)
                jobId: `batch:${postId}:${Date.now()}`, // Unique ID with timestamp
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
const likeQueue = new LikeQueue();
export default likeQueue;