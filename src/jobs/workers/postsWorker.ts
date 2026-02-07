import { Worker } from 'bullmq';
import { redisConnection } from "../index.js";
import vectorEmbeddingService from '../../services/VectorEmbeddingService.js';
import qdrantService from '../../services/QdrantService.js';
import { sDebug, sError } from 'sk-logger';

const connection = redisConnection();

const postsWorker = new Worker(
    'postsQueue',
    async (job) => {
        if (job.name === 'post-processing') {
            const { postId, caption, userId } = job.data;

            if (!caption) {
                sDebug(`Skipping embedding for post ${postId}: No caption.`);
                return;
            }

            if (process.env.LAZY_EMBEDDING_MODE === 'true') {
                sDebug(`Lazy Embedding Mode enabled. Skipping real-time embedding for post ${postId}.`);
                return;
            }

            try {
                sDebug(`Generating text embedding for post ${postId}...`);
                const embedding = await vectorEmbeddingService.generateTextEmbedding(caption);

                if (embedding) {
                    await qdrantService.upsertCaptionVector(postId, embedding, {
                        userId,
                        caption_preview: caption.substring(0, 100)
                    });

                    // Mark as embedded in DB
                    const { pool } = await import('../../config/pg.config.js');
                    await pool.query(`UPDATE posts SET caption_embedded = TRUE, updated_at = NOW() WHERE post_id = $1`, [postId]);

                    sDebug(`✓ Successfully stored caption embedding for post ${postId}`);
                }
            } catch (error) {
                sError(`Failed to process caption embedding for post ${postId}:`, error);
                throw error; // Re-throw to allow BullMQ to retry
            }
        }
    },
    {
        connection,
        concurrency: 5,
    }
);

postsWorker.on('completed', (job) => {
    sDebug(`✓ Post job completed: ${job.id}`);
});

postsWorker.on('failed', (job, err) => {
    sError(`✗ Post job failed: ${job?.id}`, err);
});

export default postsWorker;
