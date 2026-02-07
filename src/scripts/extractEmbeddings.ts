
import 'dotenv/config';
import { pool } from '../config/pg.config.js';
import qdrantService from '../services/QdrantService.js';
import vectorEmbeddingService from '../services/VectorEmbeddingService.js';
import path from 'path';
import { sInfo, sError, sDebug } from 'sk-logger';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The media files are relative to the public directory
const PUBLIC_DIR = path.join(__dirname, '../../public');

// Configuration
const CHUNK_SIZE = 1000; // Batch size for DB queries
const BATCH_SIZE = 5;   // Number of images per AI server request (reduced for reliability)
const CONCURRENCY = 3;    // Max concurrent requests to AI server (reduced to prevent timeouts)

async function processMediaBatch(mediaItems: any[]) {
    const batches = [];
    for (let i = 0; i < mediaItems.length; i += BATCH_SIZE) {
        batches.push(mediaItems.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;
    let completed = 0;

    for (let i = 0; i < totalBatches; i += CONCURRENCY) {
        const currentChunk = batches.slice(i, i + CONCURRENCY);

        await Promise.all(currentChunk.map(async (batch) => {
            try {
                const missingIds: string[] = [];
                const embeddingItems = batch.map((m: any) => {
                    const fullPath = path.join(PUBLIC_DIR, m.original_path);
                    if (!fs.existsSync(fullPath)) {
                        missingIds.push(m.id);
                        return null;
                    }
                    return {
                        filePath: fullPath,
                        caption: m.description || m.title || undefined
                    };
                }).filter(item => item !== null);

                // Mark missing files in DB immediately so we don't try again
                if (missingIds.length > 0) {
                    await pool.query(`
                        UPDATE media 
                        SET nsfw_label = 'MISSING', updated_at = NOW()
                        WHERE id = ANY($1)
                    `, [missingIds]);
                    sDebug(`Marked ${missingIds.length} missing files as MISSING in DB.`);
                }

                if (embeddingItems.length === 0) {
                    completed += batch.length;
                    return;
                }

                sDebug(`Processing batch of ${embeddingItems.length} images...`);
                // Use plural method for batch processing
                const results = await vectorEmbeddingService.generateMultiModalEmbeddings(embeddingItems as any);

                if (results && results.length > 0) {
                    const validBatchItems = batch.filter((m: any) => !missingIds.includes(m.id));

                    const qdrantItems = results.map((res: any, idx: number) => {
                        const media = validBatchItems[idx];
                        if (!media || !res) return null;

                        return {
                            mediaId: media.id,
                            visualEmbedding: res.visual_embedding,
                            visionEmbedding: res.vision_embedding,
                            textEmbedding: res.text_embedding,
                            payload: {
                                type: media.type,
                                userId: media.user_id,
                                nsfw: {
                                    predictions: res.predictions,
                                    top_label: res.top_label,
                                    probability: res.probability
                                },
                                content_type: res.content_type,
                                alignment_score: res.alignment_score,
                                ocr_text: res.ocr_text,
                                caption: res.caption
                            }
                        };
                    }).filter(item => item !== null);

                    if (qdrantItems.length > 0) {
                        await qdrantService.upsertMultimodalVectors(qdrantItems as any);

                        const mediaIds = qdrantItems.map(item => item?.mediaId);
                        // We need labels for each SUCCESSFUL item
                        const successfulResults = results.filter(r => r !== null);
                        const labels = successfulResults.map(res => res.top_label);

                        await pool.query(`
                            UPDATE media 
                            SET nsfw_label = data.label, updated_at = NOW()
                            FROM (SELECT unnest($1::uuid[]) as id, unnest($2::text[]) as label) as data
                            WHERE media.id = data.id
                        `, [mediaIds, labels]);
                    }
                }

                completed += batch.length;
                const progress = ((completed / mediaItems.length) * 100).toFixed(2);
                sDebug(`Media Progress: ${progress}% (${completed}/${mediaItems.length})`);

            } catch (err) {
                sError(`Error processing media batch:`, err);
            }
        }));
    }
}

async function processCaptionsBatch(posts: any[]) {
    const batches = [];
    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
        batches.push(posts.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;
    let completed = 0;

    for (let i = 0; i < totalBatches; i += CONCURRENCY) {
        const currentChunk = batches.slice(i, i + CONCURRENCY);

        await Promise.all(currentChunk.map(async (batch) => {
            try {
                const captions = batch.map((p: any) => p.caption);
                sDebug(`Processing batch of ${captions.length} captions...`);

                const embeddings = await vectorEmbeddingService.generateTextEmbeddings(captions);

                if (embeddings.length > 0) {
                    const qdrantItems = batch.map((post: any, idx: number) => {
                        if (!embeddings[idx]) return null;
                        return {
                            postId: post.post_id,
                            vector: embeddings[idx],
                            payload: {
                                userId: post.user_id,
                                created_at: post.created_at,
                                caption: post.caption
                            }
                        };
                    }).filter(item => item !== null);

                    if (qdrantItems.length > 0) {
                        await qdrantService.upsertCaptionVectors(qdrantItems as any);

                        const postIds = qdrantItems.map(item => item?.postId);
                        await pool.query(`
                            UPDATE posts 
                            SET caption_embedded = TRUE, updated_at = NOW()
                            WHERE post_id = ANY($1)
                        `, [postIds]);
                    }
                }

                completed += batch.length;
                const progress = ((completed / posts.length) * 100).toFixed(2);
                sDebug(`Caption Progress: ${progress}% (${completed}/${posts.length})`);

            } catch (err) {
                sError(`Error processing caption batch:`, err);
            }
        }));
    }
}

export async function main() {
    sInfo('Starting continuous extraction script (Media + Post Captions)...');
    sInfo(`Settings: CHUNK_SIZE=${CHUNK_SIZE}, BATCH_SIZE=${BATCH_SIZE}, CONCURRENCY=${CONCURRENCY}`);

    try {
        let hasMoreMedia = true;
        let hasMoreCaptions = true;
        let totalMediaProcessed = 0;
        let totalCaptionsProcessed = 0;

        let lastMediaId = null;
        let lastPostId = null;

        while (hasMoreMedia || hasMoreCaptions) {
            // 1. Process Media
            if (hasMoreMedia) {
                const mediaResult: any = await pool.query(`
                    SELECT id, original_path, type, user_id, title, description 
                    FROM media 
                    WHERE nsfw_label IS NULL 
                    AND deleted_at IS NULL
                    AND type = 'image'
                    ${lastMediaId ? 'AND id > $2' : ''}
                    ORDER BY id ASC
                    LIMIT $1
                `, lastMediaId ? [CHUNK_SIZE, lastMediaId] : [CHUNK_SIZE]);

                if (mediaResult.rows.length === 0) {
                    sInfo('✓ No more media to process.');
                    hasMoreMedia = false;
                } else {
                    sInfo(`Processing ${mediaResult.rows.length} media items...`);
                    await processMediaBatch(mediaResult.rows);
                    totalMediaProcessed += mediaResult.rows.length;
                    lastMediaId = mediaResult.rows[mediaResult.rows.length - 1].id;
                }
            }

            // 2. Process Post Captions
            if (hasMoreCaptions) {
                const postsResult: any = await pool.query(`
                    SELECT post_id, user_id, caption, created_at
                    FROM posts
                    WHERE caption_embedded = FALSE
                    AND caption IS NOT NULL
                    AND caption != ''
                    AND status = 'published'
                    ${lastPostId ? 'AND post_id > $2' : ''}
                    ORDER BY post_id ASC
                    LIMIT $1
                `, lastPostId ? [CHUNK_SIZE, lastPostId] : [CHUNK_SIZE]);

                if (postsResult.rows.length === 0) {
                    sInfo('✓ No more post captions to process.');
                    hasMoreCaptions = false;
                } else {
                    sInfo(`Processing ${postsResult.rows.length} post captions...`);
                    await processCaptionsBatch(postsResult.rows);
                    totalCaptionsProcessed += postsResult.rows.length;
                    lastPostId = postsResult.rows[postsResult.rows.length - 1].post_id;
                }
            }

            sInfo(`Loop status: Total Media: ${totalMediaProcessed}, Total Captions: ${totalCaptionsProcessed}`);
        }

        sInfo('All processing complete!');
        sInfo(`Total media processed: ${totalMediaProcessed}`);
        sInfo(`Total captions processed: ${totalCaptionsProcessed}`);

    } catch (err) {
        sError('Fatal error in extraction script:', err);
        throw err;
    }
}

// Only run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().then(() => {
        pool.end();
        process.exit(0);
    }).catch(err => {
        sError('Script failed:', err);
        pool.end();
        process.exit(1);
    });
}
