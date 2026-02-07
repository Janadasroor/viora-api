
import { pool } from '../../src/config/pg.config.js';
import vectorEmbeddingService from '../../src/services/VectorEmbeddingService.js';
import qdrantService from '../../src/services/QdrantService.js';
import { v4 as uuidv4 } from 'uuid';
import { sInfo, sError } from 'sk-logger';

const SPACE_POSTS = [
    "The future of space exploration lies in reusable rockets and sustainable habitats on Mars. We must push the boundaries of technology to become a multi-planetary species. The recent advancements in propulsion systems are truly groundbreaking.",
    "Watching the latest rocket launch was mesmerizing. The sheer power required to break Earth's gravity is a testament to human engineering. Mars is calling, and we are answering with innovation and determination. Space is the final frontier.",
    "Deep space communication is challenging but essential for long-duration missions. As we venture further into the cosmos, establishing a reliable network across the solar system becomes critical. The distances are vast, but our ambition is greater."
];

const COOKING_POSTS = [
    "Authentic Italian carbonara requires only eggs, pecorino cheese, guanciale, and black pepper. No cream! The creaminess comes from the emulsion of pasta water and cheese. Respecting tradition is key to mastering this classic Roman dish.",
    "Making fresh pasta from scratch is a labor of love. The texture of homemade tagliatelle paired with a slow-cooked ragu creates a symphony of flavors. Italian cuisine celebrates simple, high-quality ingredients treated with care.",
    "Pizza Napoletana is defined by its soft, airy crust and simple tomato sauce. The dough needs to ferment for at least 24 hours to develop that signature flavor. Wood-fired ovens add a smoky char that elevates the humble pizza to art."
];

async function seed() {
    const client = await pool.connect();
    try {
        // Get a user
        const userRes = await client.query('SELECT user_id FROM users LIMIT 1');
        if (userRes.rows.length === 0) {
            throw new Error("No users found");
        }
        const userId = userRes.rows[0].user_id;
        sInfo(`Seeding posts for user: ${userId}`);

        const allPosts = [...SPACE_POSTS, ...COOKING_POSTS];

        for (const caption of allPosts) {
            const postId = uuidv4();
            const mediaId = uuidv4();
            const mediaUrl = `https://via.placeholder.com/150?text=TextPost`; // Dummy URL

            // 1. Create Media
            await client.query(`
                INSERT INTO media (id, user_id, type, original_path, thumbnail_path, original_filename, status, original_size, width, height, mime_type, created_at, updated_at)
                VALUES ($1, $2, 'image', $3, $3, 'text-post-dummy.jpg', 'ready', 1024, 150, 150, 'image/jpeg', NOW(), NOW())
            `, [mediaId, userId, mediaUrl]);

            // 2. Create Post
            await client.query(`
                INSERT INTO posts (post_id, user_id, caption, post_type, visibility, likes_count, comments_count, created_at, updated_at, status)
                VALUES ($1, $2, $3, 'photo', 'public', $4, $5, NOW(), NOW(), 'published')
            `, [postId, userId, caption, Math.floor(Math.random() * 5000) + 1000, Math.floor(Math.random() * 1000) + 100]);

            // 3. Link Post Media
            await client.query(`
                INSERT INTO post_media (post_id, media_id, media_order)
                VALUES ($1, $2, 0)
            `, [postId, mediaId]);

            // 4. Generate Embeddings & Upsert to Qdrant
            sInfo(`Generating embeddings for post: "${caption.substring(0, 30)}..."`);

            // Get text embedding from service
            const textEmbedding = await vectorEmbeddingService.generateTextEmbedding(caption);

            if (!textEmbedding) {
                sError(`Failed to generate text embedding for caption: ${caption}`);
                continue;
            }

            // Create a dummy/noise visual embedding (512-dim for CLIP)
            const visualEmbedding = Array(512).fill(0).map(() => Math.random() * 0.01);

            // Upsert to Qdrant
            await qdrantService.upsertMultimodalVector(
                mediaId,
                visualEmbedding,
                null, // No vision (ViT) embedding
                textEmbedding,
                {
                    post_id: postId,
                    userId: userId,
                    caption: caption,
                    content_type: 'text_only'
                }
            );

            sInfo(`Successfully processed post & embeddings.`);
        }

        sInfo("Seeding complete!");

    } catch (error) {
        sError("Seeding failed:", error);
    } finally {
        client.release();
        // Allow time for async logs/operations if needed
        setTimeout(() => process.exit(0), 1000);
    }
}

seed();
