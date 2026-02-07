
import { qdrantClient } from '../src/config/qdrant.config.js';

async function initQdrant() {
    const mediaCollection = 'media_embeddings';
    const mediaVectorSize = 768;

    const captionCollection = 'post_caption_embeddings';
    const captionVectorSize = 768;

    const multimodalCollection = 'media_embeddings_v2';

    console.log('--- Initializing Qdrant Collections ---');

    // 1. Media Collection
    try {
        const collections = await qdrantClient.getCollections();
        const mediaExists = collections.collections.some(c => c.name === mediaCollection);

        if (mediaExists) {
            console.log(`Collection ${mediaCollection} already exists. Deleting for a fresh start...`);
            await qdrantClient.deleteCollection(mediaCollection);
        }

        console.log(`Creating collection: ${mediaCollection} (size: ${mediaVectorSize})`);
        await qdrantClient.createCollection(mediaCollection, {
            vectors: {
                size: mediaVectorSize,
                distance: 'Cosine',
            },
        });

        console.log(`Creating indexes for ${mediaCollection}...`);
        await qdrantClient.createPayloadIndex(mediaCollection, {
            field_name: 'nsfw.top_label',
            field_schema: 'keyword',
            wait: true
        });
        await qdrantClient.createPayloadIndex(mediaCollection, {
            field_name: 'type',
            field_schema: 'keyword',
            wait: true
        });
        await qdrantClient.createPayloadIndex(mediaCollection, {
            field_name: 'userId',
            field_schema: 'integer',
            wait: true
        });

        console.log(` ${mediaCollection} initialized successfully.`);
    } catch (err) {
        console.error(`Error initializing ${mediaCollection}:`, err);
    }

    // 2. Caption Collection
    try {
        const collections = await qdrantClient.getCollections();
        const captionExists = collections.collections.some(c => c.name === captionCollection);

        if (captionExists) {
            console.log(`Collection ${captionCollection} already exists. Deleting for a fresh start...`);
            await qdrantClient.deleteCollection(captionCollection);
        }

        console.log(`Creating collection: ${captionCollection} (size: ${captionVectorSize})`);
        await qdrantClient.createCollection(captionCollection, {
            vectors: {
                size: captionVectorSize,
                distance: 'Cosine',
            },
        });

        console.log(` ${captionCollection} initialized successfully.`);
    } catch (err) {
        console.error(`Error initializing ${captionCollection}:`, err);
    }

    // 3. Multi-modal Collection (v2)
    try {
        const collections = await qdrantClient.getCollections();
        const multimodalExists = collections.collections.some(c => c.name === multimodalCollection);

        if (multimodalExists) {
            console.log(`Collection ${multimodalCollection} already exists. Deleting for a fresh start...`);
            await qdrantClient.deleteCollection(multimodalCollection);
        }

        console.log(`Creating multi-modal collection: ${multimodalCollection}`);
        await qdrantClient.createCollection(multimodalCollection, {
            vectors: {
                visual: {
                    size: 512, // CLIP
                    distance: 'Cosine',
                },
                vision: {
                    size: 768, // ViT
                    distance: 'Cosine',
                },
                text: {
                    size: 768, // MPNet
                    distance: 'Cosine',
                },
            },
        });

        console.log(`Creating indexes for ${multimodalCollection}...`);
        const indexes = [
            'nsfw.top_label',
            'type',
            'userId',
            'content_type',
            'embedding_version'
        ];

        for (const field of indexes) {
            await qdrantClient.createPayloadIndex(multimodalCollection, {
                field_name: field,
                field_schema: 'keyword',
                wait: true
            });
        }

        console.log(` ${multimodalCollection} initialized successfully.`);
    } catch (err) {
        console.error(`Error initializing ${multimodalCollection}:`, err);
    }

    console.log('--- Qdrant Initialization Complete ---');
}

initQdrant().catch(console.error);
