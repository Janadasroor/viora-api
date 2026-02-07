import { Queue } from "bullmq";
import { redisConnection } from "../index.js";
import { sDebug, sError } from "sk-logger";

const commentQueue = new Queue("commentQueue", { connection: redisConnection() });

class CommentQueue {
  constructor() {
    if (process.env.NODE_ENV !== "test") {
      this.setupRepeatingJobs();
    }
  }

  setupRepeatingJobs() {
    commentQueue.add(
      "batch-process-all-comments",
      {},
      {
        repeat: {
          every: 5000,
        },
        jobId: "recurring-comment-processor",
      }
    );
    commentQueue.add(
      "batch-process-all-reel-comments",
      {},
      {
        repeat: {
          every: 5000,
        },
        jobId: "recurring-reel-comment-processor",
      }
    );
    commentQueue.add(
      "batch-process-all-story-comments",
      {},
      {
        repeat: {
          every: 5000,
        },
        jobId: "recurring-story-comment-processor",
      }
    );
  }

  async addCommentJob(commentId: string, options: { priority?: number } = {}) {
    const { priority = 10 } = options;
    await commentQueue.add(
      "batch-process-comment",
      { commentId },
      {
        priority,
        jobId: `batch:comment_${commentId}:${Date.now()}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );
  }

  async addReelCommentJob(commentId: string, options: { priority?: number } = {}) {
    const { priority = 10 } = options;
    await commentQueue.add(
      "batch-process-reel-comment",
      { commentId },
      {
        priority,
        jobId: `batch:reel_comment_${commentId}:${Date.now()}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );
  }

  async addStoryCommentJob(commentId: string, options: { priority?: number } = {}) {
    const { priority = 10 } = options;
    await commentQueue.add(
      "batch-process-story-comment",
      { commentId },
      {
        priority,
        jobId: `batch:story_comment_${commentId}:${Date.now()}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      }
    );
  }
}

const commentsQueue = new CommentQueue();
export { commentsQueue };
