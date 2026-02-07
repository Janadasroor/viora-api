import 'dotenv/config';
import { pool } from '../config/pg.config.js';
import postsService from '../services/PostsService.js';
import cassandraFeedRepository from '../repositories/CassandraFeedRepository.js';
import qdrantService from '../services/QdrantService.js';
import { sInfo, sError } from 'sk-logger';

/**
 * Script to delete all posts by calling the service layer directly.
 * This bypasses the API gateway but ensures all side effects 
 * (media cleanup, count updates, Qdrant embeddings, and Cassandra metadata) are handled.
 */
async function deleteAllPosts() {
    try {
        sInfo('Fetching all posts...');
        const result = await pool.query('SELECT post_id, user_id FROM posts');
        const posts = result.rows;

        if (posts.length === 0) {
            sInfo('No posts found to delete in Postgres.');
        } else {
            sInfo(`Found ${posts.length} posts. Starting sequential deletion...`);
            for (const post of posts) {
                try {
                    // This handles:
                    // 1. Postgres deletion
                    // 2. Qdrant Caption Embeddings deletion
                    // 3. Cassandra Post Metadata deletion
                    // 4. Queuing Media Cleanup (Files + Qdrant Media Embeddings)
                    await postsService.deletePost(post.post_id, post.user_id, true);
                    sInfo(`✓ Deleted post: ${post.post_id}`);
                } catch (err: any) {
                    sError(`✗ Failed to delete post ${post.post_id}:`, err.message);
                }
            }
        }

        // Broad Cassandra Clean up
        sInfo('Truncating Cassandra feed caches...');
        await cassandraFeedRepository.truncateFeedCaches();

        // Broad Qdrant Clean up (because old point IDs were corrupted due to parseInt bug)
        sInfo('Wiping and recreating Qdrant collections...');
        await qdrantService.wipeAllEmbeddings();

        sInfo('Full deletion process complete.');
    } catch (err: any) {
        sError('Error in deleteAllPosts script:', err.message);
    } finally {
        await pool.end();
    }
}

// NOTE: This script is intended to be run via tsx or similar.
// Example: npx tsx src/scripts/deleteAllPosts.ts
// The user requested to run this script.
deleteAllPosts();
