import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
const connection = redisConnection();

class CommentLikeQueue {
    private queue: Queue;
    constructor() {
        this.queue = new Queue('commentLikeQueue', { connection });
        this.setupRepeatingJobs();
    }

    getQueue() {
        return this.queue;
    }

    setupRepeatingJobs() {
        // Process ALL comments with pending likes every 5 seconds
        this.queue.add(
            'batch-process-all-comment-likes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-comment-like-processor' // Prevent duplicates
            }
        );

        // Process ALL pending comment unlikes every 5 seconds
        this.queue.add(
            'batch-process-all-comment-unlikes',
            {},
            {
                repeat: {
                    every: 5000 // Run every 5 seconds
                },
                jobId: 'recurring-comment-unlike-processor' // Prevent duplicates
            }
        );
    }

    async addBatchJob(commentId: string | number, options: { priority?: number } = {}) {
        const { priority = 10 } = options; // Default priority: 10 (lower number = higher priority)

        await this.queue.add(
            'batch-process-likes',
            { commentId: commentId },
            {
                priority, // 1 = highest priority (viral posts)
                jobId: `batch:${commentId}:${Date.now()}`, // Unique ID with timestamp
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
const commentLikeQueue = new CommentLikeQueue();
export default commentLikeQueue;
