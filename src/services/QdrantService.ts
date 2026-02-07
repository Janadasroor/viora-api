
import { qdrantClient } from '../config/qdrant.config.js';
import { sError, sDebug, sInfo } from 'sk-logger';
import { v4 as uuidv4 } from 'uuid';

export interface NSFWResult {
    predictions: Record<string, number>;
    top_label: string;
    probability: number;
}

export interface MediaPayload {
    original_media_id: number | string;
    type?: 'image' | 'video' | 'audio';
    targetType?: string;
    targetId?: string | number;
    userId?: string;
    nsfw?: NSFWResult;
    content_type?: 'meme' | 'aesthetic' | 'mixed' | 'text_only';
    alignment_score?: number;
    ocr_text?: string;
    caption?: string;
    embedding_version?: string; // 'v1' (ViT) or 'v2' (CLIP)
    [key: string]: any;
}

class QdrantService {
    // Legacy collection (backward compatibility)
    private mediaCollection = 'media_embeddings_legacy_512';
    private mediaVectorSize = 512; // CLIP size (was 768 ViT)

    // New multi-modal collection
    private multimodalCollection = 'media_embeddings_v2';
    private clipVectorSize = 512; // CLIP visual embedding
    private visionVectorSize = 768; // ViT vision embedding
    private textVectorSize = 768; // Text embedding

    private captionCollection = 'post_caption_embeddings';
    private captionVectorSize = 768;

    constructor() {
        this.init();
    }

    async init() {
        await this.listCollections();
        await this.ensureCollection(this.mediaCollection, this.mediaVectorSize);
        await this.ensureMultimodalCollection();
        await this.ensureCollection(this.captionCollection, this.captionVectorSize);
    }

    async listCollections() {
        try {
            const result = await qdrantClient.getCollections();
            sInfo('Available Qdrant collections:', result.collections.map(c => c.name));
        } catch (error) {
            sError('Error listing Qdrant collections:', error);
        }
    }

    async ensureCollection(name: string, size: number) {
        try {
            const result = await qdrantClient.getCollections();
            const exists = result.collections.some(c => c.name === name);

            if (!exists) {
                sInfo(`Creating Qdrant collection: ${name} (size: ${size})`);
                await qdrantClient.createCollection(name, {
                    vectors: {
                        size: size,
                        distance: 'Cosine',
                    },
                });

                // Create indexes for common fields to speed up filtering
                if (name === this.mediaCollection) {
                    await qdrantClient.createPayloadIndex(name, {
                        field_name: 'nsfw.top_label',
                        field_schema: 'keyword',
                        wait: true
                    });
                    await qdrantClient.createPayloadIndex(name, {
                        field_name: 'type',
                        field_schema: 'keyword',
                        wait: true
                    });
                    await qdrantClient.createPayloadIndex(name, {
                        field_name: 'userId',
                        field_schema: 'integer',
                        wait: true
                    });
                }
            }
        } catch (error) {
            sError(`Error ensuring Qdrant collection ${name}:`, error);
        }
    }

    /**
     * Ensure multi-modal collection exists with named vectors
     */
    async ensureMultimodalCollection() {
        try {
            const result = await qdrantClient.getCollections();
            const exists = result.collections.some(c => c.name === this.multimodalCollection);

            if (!exists) {
                sInfo(`Creating multi-modal Qdrant collection: ${this.multimodalCollection}`);
                await qdrantClient.createCollection(this.multimodalCollection, {
                    vectors: {
                        // Named vectors for multi-modal support
                        visual: {
                            size: this.clipVectorSize,
                            distance: 'Cosine',
                        },
                        vision: {
                            size: this.visionVectorSize,
                            distance: 'Cosine',
                        },
                        text: {
                            size: this.textVectorSize,
                            distance: 'Cosine',
                        },
                    },
                });

                // Create indexes
                await qdrantClient.createPayloadIndex(this.multimodalCollection, {
                    field_name: 'nsfw.top_label',
                    field_schema: 'keyword',
                    wait: true
                });
                await qdrantClient.createPayloadIndex(this.multimodalCollection, {
                    field_name: 'type',
                    field_schema: 'keyword',
                    wait: true
                });
                await qdrantClient.createPayloadIndex(this.multimodalCollection, {
                    field_name: 'userId',
                    field_schema: 'integer',
                    wait: true
                });
                await qdrantClient.createPayloadIndex(this.multimodalCollection, {
                    field_name: 'content_type',
                    field_schema: 'keyword',
                    wait: true
                });
                await qdrantClient.createPayloadIndex(this.multimodalCollection, {
                    field_name: 'embedding_version',
                    field_schema: 'keyword',
                    wait: true
                });

                sInfo(`✓ Multi-modal collection created`);
            }
        } catch (error) {
            sError(`Error ensuring multi-modal collection:`, error);
        }
    }

    /**
     * Upsert media vector (legacy - backward compatibility)
     */
    async upsertMediaVector(mediaId: number | string, vector: number[], payload: Omit<MediaPayload, 'original_media_id'> = {}) {
        try {
            await this.ensureCollection(this.mediaCollection, this.mediaVectorSize);

            if (vector.length !== this.mediaVectorSize) {
                sError(`Media Vector length mismatch! Expected ${this.mediaVectorSize}, got ${vector.length}.`);
            }

            let finalId: string | number;
            if (typeof mediaId === 'number') {
                finalId = mediaId;
            } else {
                // If it's a UUID or non-numeric string, use it directly.
                // Qdrant supports UUID strings as IDs.
                finalId = /^\d+$/.test(mediaId) ? parseInt(mediaId, 10) : mediaId;
            }

            await qdrantClient.upsert(this.mediaCollection, {
                wait: true,
                points: [
                    {
                        id: finalId,
                        vector: vector,
                        payload: {
                            original_media_id: mediaId,
                            embedding_version: 'v1', // Mark as old ViT embedding
                            ...payload
                        },
                    },
                ],
            });

            sDebug(`Upserted media vector for ${mediaId} into Qdrant (legacy collection).`);

        } catch (error) {
            sError('Error upserting media to Qdrant:', error);
        }
    }

    /**
     * Upsert multi-modal embeddings (new method)
     */
    async upsertMultimodalVector(
        mediaId: number | string,
        visualEmbedding: number[],
        visionEmbedding: number[] | null,
        textEmbedding: number[] | null,
        payload: Omit<MediaPayload, 'original_media_id'> = {}
    ) {
        await this.upsertMultimodalVectors([{
            mediaId,
            visualEmbedding,
            visionEmbedding,
            textEmbedding,
            payload
        }]);
    }

    /**
     * Batch upsert multi-modal embeddings
     */
    async upsertMultimodalVectors(
        items: Array<{
            mediaId: number | string;
            visualEmbedding: number[];
            visionEmbedding: number[] | null;
            textEmbedding: number[] | null;
            payload: Omit<MediaPayload, 'original_media_id'>;
        }>
    ) {
        try {
            await this.ensureMultimodalCollection();

            const points = items.map(item => {
                if (item.visualEmbedding.length !== this.clipVectorSize) {
                    sError(`Visual embedding length mismatch for ${item.mediaId}! Expected ${this.clipVectorSize}, got ${item.visualEmbedding.length}.`);
                    return null;
                }

                let finalId: string | number;
                if (typeof item.mediaId === 'number') {
                    finalId = item.mediaId;
                } else {
                    finalId = /^\d+$/.test(item.mediaId) ? parseInt(item.mediaId, 10) : item.mediaId;
                }

                const vectors: Record<string, number[]> = {
                    visual: item.visualEmbedding,
                };

                if (item.visionEmbedding && item.visionEmbedding.length === this.visionVectorSize) {
                    vectors.vision = item.visionEmbedding;
                }

                if (item.textEmbedding && item.textEmbedding.length === this.textVectorSize) {
                    vectors.text = item.textEmbedding;
                }

                return {
                    id: finalId,
                    vector: vectors,
                    payload: {
                        original_media_id: item.mediaId,
                        embedding_version: 'v2',
                        has_vision_embedding: item.visionEmbedding !== null && item.visionEmbedding.length > 0,
                        has_text_embedding: item.textEmbedding !== null && item.textEmbedding.length > 0,
                        ...item.payload
                    },
                };
            }).filter(p => p !== null) as any[];

            if (points.length === 0) return;

            await qdrantClient.upsert(this.multimodalCollection, {
                wait: true,
                points: points,
            });

            sDebug(`Batch upserted ${points.length} multi-modal vectors into Qdrant.`);

        } catch (error) {
            sError('Error batch upserting multi-modal media to Qdrant:', error);
        }
    }

    /**
     * Upsert a single caption vector
     */
    async upsertCaptionVector(postId: number | string, vector: number[], payload: Record<string, any> = {}) {
        await this.upsertCaptionVectors([{ postId, vector, payload }]);
    }

    async upsertCaptionVectors(items: Array<{ postId: number | string; vector: number[]; payload?: Record<string, any> }>) {
        try {
            if (items.length === 0) return;
            await this.ensureCollection(this.captionCollection, this.captionVectorSize);

            const points = items.map(item => {
                let finalId: string | number;
                if (typeof item.postId === 'number') {
                    finalId = item.postId;
                } else {
                    finalId = /^\d+$/.test(item.postId) ? parseInt(item.postId, 10) : item.postId;
                }

                return {
                    id: finalId,
                    vector: item.vector,
                    payload: {
                        post_id: item.postId,
                        ...item.payload
                    },
                };
            });

            await qdrantClient.upsert(this.captionCollection, {
                wait: true,
                points: points,
            });

            sDebug(`Upserted ${items.length} caption vectors into Qdrant.`);
        } catch (error) {
            sError('Error batch upserting captions to Qdrant:', error);
        }
    }

    /**
     * Search similar media (legacy - uses single vector)
     */
    async searchSimilarMedia(vector: number[], limit: number = 10, filter: any = null) {
        try {
            return await qdrantClient.search(this.mediaCollection, {
                vector: vector,
                limit: limit,
                filter: filter,
                with_payload: true
            });
        } catch (error) {
            sError('Error searching similar media:', error);
            return [];
        }
    }

    /**
     * Search similar media using visual embedding (multi-modal collection)
     */
    async searchSimilarMediaVisual(
        visualVector: number[],
        limit: number = 10,
        filter: any = null
    ) {
        try {
            await this.ensureMultimodalCollection();
            return await qdrantClient.search(this.multimodalCollection, {
                vector: {
                    name: 'visual',
                    vector: visualVector
                },
                limit: limit,
                filter: filter,
                with_payload: true
            });
        } catch (error) {
            sError('Error searching similar media (visual):', error);
            return [];
        }
    }

    /**
     * Search similar media using text embedding (multi-modal collection)
     */
    async searchSimilarMediaText(
        textVector: number[],
        limit: number = 10,
        filter: any = null
    ) {
        try {
            await this.ensureMultimodalCollection();
            return await qdrantClient.search(this.multimodalCollection, {
                vector: {
                    name: 'text',
                    vector: textVector
                },
                limit: limit,
                filter: filter,
                with_payload: true
            });
        } catch (error) {
            sError('Error searching similar media (text):', error);
            return [];
        }
    }

    /**
     * Hybrid search: combine visual and text similarity
     */
    async searchSimilarMediaHybrid(
        visualVector: number[],
        textVector: number[] | null,
        limit: number = 10,
        filter: any = null,
        visualWeight: number = 0.6,
        textWeight: number = 0.4
    ) {
        try {
            await this.ensureMultimodalCollection();

            // Perform separate searches
            const visualResults = await this.searchSimilarMediaVisual(visualVector, limit * 2, filter);
            const textResults = textVector
                ? await this.searchSimilarMediaText(textVector, limit * 2, filter)
                : [];

            // Combine and score results
            const scoreMap = new Map<string, { score: number; payload: any }>();

            // Add visual scores
            visualResults.forEach((result: any) => {
                const mediaId = result.payload?.original_media_id?.toString();
                if (mediaId) {
                    scoreMap.set(mediaId, {
                        score: (result.score || 0) * visualWeight,
                        payload: result.payload
                    });
                }
            });

            // Add text scores
            textResults.forEach((result: any) => {
                const mediaId = result.payload?.original_media_id?.toString();
                if (mediaId) {
                    const existing = scoreMap.get(mediaId);
                    if (existing) {
                        existing.score += (result.score || 0) * textWeight;
                    } else {
                        scoreMap.set(mediaId, {
                            score: (result.score || 0) * textWeight,
                            payload: result.payload
                        });
                    }
                }
            });

            // Sort by combined score and return top results
            const sorted = Array.from(scoreMap.entries())
                .sort((a, b) => b[1].score - a[1].score)
                .slice(0, limit)
                .map(([mediaId, data]) => ({
                    id: mediaId,
                    score: data.score,
                    payload: data.payload
                }));

            return sorted;
        } catch (error) {
            sError('Error in hybrid search:', error);
            return [];
        }
    }

    /**
     * Build a Qdrant filter based on safeMode
     */
    buildSafeFilter(safeMode: number = 1) {
        if (safeMode === 0) {
            return {
                must: [{ key: 'nsfw.top_label', match: { value: 'safe' } }]
            };
        } else if (safeMode === 1) {
            return {
                must_not: [{ key: 'nsfw.top_label', match: { value: 'sexual' } }]
            };
        }
        return null; // safeMode 2: no filter
    }

    /**
     * Search media with a safety filter (excluding sexual content)
     */
    async searchSafeSimilarMedia(vector: number[], limit: number = 10, safeMode: number = 1) {
        const filter = this.buildSafeFilter(safeMode);
        return this.searchSimilarMedia(vector, limit, filter);
    }

    async searchSimilarCaptions(vector: number[], limit: number = 10) {
        try {
            return await qdrantClient.search(this.captionCollection, {
                vector: vector,
                limit: limit,
                with_payload: true
            });
        } catch (error) {
            sError('Error searching similar captions:', error);
            return [];
        }
    }

    /**
     * Retrieve vector for a specific media ID (legacy collection)
     */
    async getMediaVector(mediaId: string | number): Promise<number[] | null> {
        try {
            const mId = mediaId.toString();
            sInfo(`[QdrantSearch] Attempting to find vector for ID: "${mId}"`);

            // 1. Try direct retrieval by ID
            const result = await qdrantClient.retrieve(this.mediaCollection, {
                ids: [mediaId],
                with_vector: true
            });

            if (result && result.length > 0 && result[0]?.vector) {
                sInfo(`[QdrantSearch] Success: Found vector via direct Point ID match: ${mId}`);
                return result[0].vector as number[];
            }

            // 2. Try searching by payload original_media_id
            const scrollResult = await qdrantClient.scroll(this.mediaCollection, {
                filter: {
                    must: [
                        {
                            key: 'original_media_id',
                            match: { value: mediaId }
                        }
                    ]
                },
                limit: 1,
                with_vector: true
            });

            if (scrollResult.points.length > 0 && scrollResult.points[0]?.vector) {
                sInfo(`[QdrantSearch] Success: Found vector via payload.original_media_id match`);
                return scrollResult.points[0].vector as number[];
            }

            sError(`[QdrantSearch] FAILED: Vector not found for media ID: ${mId}`);
            return null;
        } catch (error) {
            sError(`[QdrantSearch] ERROR retrieving media vector for ${mediaId}:`, error);
            return null;
        }
    }

    /**
     * Retrieve multi-modal vectors for a specific media ID
     */
    async getMultimodalVectors(mediaId: string | number): Promise<{
        visual: number[] | null;
        vision: number[] | null;
        text: number[] | null;
    } | null> {
        try {
            await this.ensureMultimodalCollection();

            const result = await qdrantClient.retrieve(this.multimodalCollection, {
                ids: [mediaId],
                with_vector: true
            });

            if (result && result.length > 0 && result[0]?.vector) {
                const vectors = result[0].vector as Record<string, number[]>;
                return {
                    visual: vectors.visual || null,
                    vision: vectors.vision || null,
                    text: vectors.text || null
                };
            }

            // Try by payload
            const scrollResult = await qdrantClient.scroll(this.multimodalCollection, {
                filter: {
                    must: [
                        {
                            key: 'original_media_id',
                            match: { value: mediaId }
                        }
                    ]
                },
                limit: 1,
                with_vector: true
            });

            if (scrollResult.points.length > 0 && scrollResult.points[0]?.vector) {
                const vectors = scrollResult.points[0].vector as Record<string, number[]>;
                return {
                    visual: vectors.visual || null,
                    vision: vectors.vision || null,
                    text: vectors.text || null
                };
            }

            return null;
        } catch (error) {
            sError(`Error retrieving multi-modal vectors for ${mediaId}:`, error);
            return null;
        }
    }

    /**
     * Retrieve vectors for multiple media IDs (legacy)
     */
    async getMediaVectors(mediaIds: (string | number)[]): Promise<Map<string, number[]>> {
        try {
            const vectorMap = new Map<string, number[]>();

            if (mediaIds.length === 0) return vectorMap;

            // 1. Try direct retrieval first
            const result = await qdrantClient.retrieve(this.mediaCollection, {
                ids: mediaIds,
                with_vector: true
            });

            for (const point of result) {
                if (point.vector && point.id) {
                    const mId = (point.payload?.original_media_id as string) || (point.id.toString());
                    vectorMap.set(mId, point.vector as number[]);
                }
            }

            // 2. If some are missing, search by payload
            const missingIds = mediaIds.filter(id => !vectorMap.has(id.toString()));
            if (missingIds.length > 0) {
                const scrollResult = await qdrantClient.scroll(this.mediaCollection, {
                    filter: {
                        should: missingIds.map(id => ({
                            key: 'original_media_id',
                            match: { value: id }
                        }))
                    },
                    limit: missingIds.length,
                    with_vector: true
                });

                for (const point of scrollResult.points) {
                    if (point.vector && point.payload?.original_media_id) {
                        vectorMap.set(point.payload.original_media_id.toString(), point.vector as number[]);
                    }
                }
            }

            return vectorMap;
        } catch (error) {
            sError('Error retrieving media vectors:', error);
            return new Map();
        }
    }

    async listMedia(limit: number = 20, offset: any = null) {
        try {
            return await qdrantClient.scroll(this.mediaCollection, {
                limit: limit,
                offset: offset,
                with_payload: true,
                with_vector: false
            });
        } catch (error) {
            sError('Error scrolling media:', error);
            return { points: [], next_page_offset: null };
        }
    }

    /**
     * Delete embeddings for a specific media ID from all relevant collections
     */
    async deleteMediaEmbeddings(mediaId: string | number) {
        try {
            const finalId = typeof mediaId === 'string' && /^\d+$/.test(mediaId) ? parseInt(mediaId, 10) : mediaId;
            // Delete from multimodal collection
            await qdrantClient.delete(this.multimodalCollection, {
                wait: true,
                points: [finalId]
            });

            // Delete from legacy collection
            await qdrantClient.delete(this.mediaCollection, {
                wait: true,
                points: [finalId]
            });

            sDebug(`Deleted Qdrant embeddings for media: ${mediaId}`);
        } catch (error) {
            sError(`Error deleting Qdrant embeddings for media ${mediaId}:`, error);
        }
    }

    /**
     * Delete caption embeddings for a specific post
     */
    async deletePostCaptionEmbeddings(postId: string | number) {
        try {
            const finalId = typeof postId === 'string' && /^\d+$/.test(postId) ? parseInt(postId, 10) : postId;
            await qdrantClient.delete(this.captionCollection, {
                wait: true,
                points: [finalId]
            });
            sDebug(`Deleted Qdrant caption embeddings for post: ${postId}`);
        } catch (error) {
            sError(`Error deleting Qdrant caption embeddings for post ${postId}:`, error);
        }
    }

    /**
     * Wipes all post and caption embeddings. 
     * Use with caution!
     */
    async wipeAllEmbeddings() {
        try {
            await qdrantClient.deleteCollection(this.captionCollection);
            await qdrantClient.deleteCollection(this.multimodalCollection);
            await qdrantClient.deleteCollection(this.mediaCollection);
            sInfo('Successfully deleted all Qdrant collections for a fresh start.');
            await this.init(); // Recreate them empty
        } catch (error) {
            sError('Error wiping Qdrant collections:', error);
        }
    }
}

export default new QdrantService();
