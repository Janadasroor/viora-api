import { pool } from "../config/pg.config.js";
import cassandraFeedRepo from "../repositories/CassandraFeedRepository.js";
import qdrantService from "./QdrantService.js";
import { sDebug, sError, sInfo } from "sk-logger";

// import mediaRepository from "../repositories/MediaRepository.js"; // Unused

interface UserPreferenceVectors {
    visual: number[] | null; // CLIP
    vision: number[] | null; // ViT
    text: number[] | null;
}

interface RankedPostCandidate {
    postId: number;
    score: number;
    contentType?: string;
}

class FeedPrecomputeService {
    // Multi-signal ranking weights
    private rankingWeights = {
        visual: 0.20,      // CLIP Visual Similarity (Semantic)
        vision: 0.25,      // ViT Vision Similarity (Pure Aestethic/Visual)
        text: 0.15,        // Text Similarity
        engagement: 0.20,  // Engagement based score
        recency: 0.10,     // Recency based score
        diversity: 0.10    // Diversity boost
    };

    /**
     * Precompute and cache the feed for a specific user
     */
    async precomputeUserFeed(userId: string) {
        let followedEntries: any[] = [];
        let finalEntries: any[] = [];

        try {
            sInfo(`Precomputing feed for user ${userId}...`);

            // 0. Get "Not Interested" list and "Interested" signals from Cassandra
            let recentInteractions: any[] = [];
            try {
                recentInteractions = await Promise.race([
                    cassandraFeedRepo.getUserInteractions(userId, 50),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Cassandra Timeout')), 3000))
                ]) as any[];
            } catch (e: any) {
                sError(`[Precompute] Interaction lookup failed for ${userId}: ${e.message}`);
                recentInteractions = [];
            }

            const blacklistedPostIds = new Set(
                recentInteractions
                    .filter(i => i.interaction_type === 'not_interested')
                    .map(i => String(i.target_id))
            );

            const interestedPostIds = recentInteractions
                .filter(i => i.interaction_type === 'interested')
                .map(i => String(i.target_id));

            // 0.5 get seen posts
            const redisService = (await import('../cache/RedisService.js')).default;
            const seenPostIds = await redisService.getSeenPosts(userId);
            const seenSet = new Set(seenPostIds);

            // 1. Get posts from Followed Users
            try {
                const followedRes = await Promise.race([
                    pool.query(`
                        SELECT p.post_id, p.created_at, p.user_id
                        FROM posts p
                        WHERE EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id)
                        AND p.user_id != $1
                        AND p.post_id != ALL($2)
                        AND p.is_archived = false
                        AND p.visibility = 'public'
                        AND p.status = 'published'
                        ORDER BY p.created_at DESC
                        LIMIT 200
                    `, [userId, seenPostIds]),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Database timeout')), 10000))
                ]);

                followedEntries = (followedRes as any).rows
                    .map((row: any) => ({
                        post_id: row.post_id,
                        score: 10 + (new Date(row.created_at).getTime() / 10000000000),
                        source: 'following' as const,
                        created_at: row.created_at,
                        author_id: row.user_id
                    }));
            } catch (error) {
                sError(`Failed to get followed posts for user ${userId}:`, error);
                // Continue with empty followed entries
            }

            // 2. Build User Preference Vector & Get Recommendations
            let suggestedEntries: any[] = [];
            try {
                // Combine Likes and "Interested" signals
                const likesRes = await Promise.race([
                    pool.query(`
                        SELECT l.target_id as post_id
                        FROM likes l
                        WHERE l.user_id = $1 AND l.target_type = 'post'
                        ORDER BY l.created_at DESC LIMIT 10
                    `, [userId]),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Database timeout')), 5000))
                ]);

                const likedPostIds = (likesRes as any).rows.map((r: any) => String(r.post_id));
                const preferenceIds = [...new Set([...likedPostIds, ...interestedPostIds])].slice(0, 15);

                if (preferenceIds.length > 0) {
                    const likedMediaRes = await pool.query(`
                        SELECT pm.media_id FROM post_media pm 
                        JOIN media m ON pm.media_id = m.id
                        WHERE pm.post_id = ANY($1) AND m.status = 'ready'
                        LIMIT 10
                    `, [preferenceIds]);

                    const mediaIds = likedMediaRes.rows.map(r => r.media_id);
                    const vectorsMap = await Promise.race([
                        qdrantService.getMediaVectors(mediaIds),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Qdrant timeout')), 8000))
                    ]) as any;
                    const vectors = Array.from((vectorsMap as any).values()).filter((v): v is number[] => !!v && (v as any).length > 0);

                    if (vectors.length > 0 && vectors[0]) {
                        const len = vectors[0].length;
                        const userVector = new Array(len).fill(0);
                        vectors.forEach(v => {
                            if (v) v.forEach((val, i) => userVector[i] += val);
                        });
                        const normalizedVector = userVector.map(val => val / vectors.length);

                        const similar = await Promise.race([
                            qdrantService.searchSimilarMedia(normalizedVector, 100),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Qdrant timeout')), 8000))
                        ]) as any;
                        const suggestedMediaIds = similar.map((s: any) => s.payload?.original_media_id).filter(Boolean);

                        if (suggestedMediaIds.length > 0) {
                            const postMediaRes = await pool.query(`
                                SELECT DISTINCT pm.post_id, p.created_at, p.user_id
                                FROM post_media pm
                                JOIN posts p ON pm.post_id = p.post_id
                                WHERE pm.media_id = ANY($1)
                                AND p.status = 'published'
                                AND p.user_id != $2
                                AND p.post_id != ALL($3)
                                AND NOT EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.following_id = p.user_id)
                                AND NOT EXISTS(SELECT 1 FROM likes l WHERE l.target_id = p.post_id AND l.user_id = $2)
                                LIMIT 100
                            `, [suggestedMediaIds, userId, seenPostIds]);

                            suggestedEntries = postMediaRes.rows
                                .filter(row => !blacklistedPostIds.has(String(row.post_id)))
                                .map((row, index) => ({
                                    post_id: row.post_id,
                                    score: 8 + (1.0 - (index * 0.05)), // Similarity score base
                                    source: 'suggested' as const,
                                    created_at: row.created_at,
                                    author_id: row.user_id
                                }));
                        }
                    }
                }
            } catch (e) {
                sError(`Error computing suggestions for ${userId}:`, e);
            }

            // 3. Fallback: Trending & Discovery (for cold-start users)
            let trendingEntries: any[] = [];
            const currentTotal = followedEntries.length + suggestedEntries.length;

            if (currentTotal < 100) {
                sInfo(`[Precompute] Sparse feed for ${userId} (${currentTotal} items). Fetching expanded discovery pool...`);

                // Increase window to 7 days and limit to 200 for broader discovery
                const trendingRes = await pool.query(`
                    SELECT p.post_id, p.created_at, p.user_id, (p.likes_count + p.comments_count * 2) as engagement_score
                    FROM posts p
                    WHERE p.created_at >= NOW() - INTERVAL '7 days'
                    AND p.visibility = 'public'
                    AND p.status = 'published'
                    AND p.user_id != $1
                    AND p.post_id != ALL($2)
                    AND NOT EXISTS(SELECT 1 FROM likes l WHERE l.target_id = p.post_id AND l.user_id = $1)
                    ORDER BY (p.likes_count + p.comments_count * 2) DESC
                    LIMIT 200
                `, [userId, seenPostIds]);

                trendingEntries = trendingRes.rows
                    .filter(row => !blacklistedPostIds.has(String(row.post_id)))
                    .map(row => ({
                        post_id: row.post_id,
                        score: 4 + Math.min(row.engagement_score / 100, 2), // Base score + engagement bonus (max 2)
                        source: 'trending' as const,
                        created_at: row.created_at,
                        author_id: row.user_id
                    }));

                // Diversity Pre-Filter: Limit max trending posts per author
                const trendingAuthorCounts = new Map<string, number>();
                trendingEntries = trendingEntries.filter(entry => {
                    const count = trendingAuthorCounts.get(entry.author_id) || 0;
                    if (count < 3) {
                        trendingAuthorCounts.set(entry.author_id, count + 1);
                        return true;
                    }
                    return false;
                });

                // If STILL very sparse, add non-trending random discovery posts
                if (currentTotal + trendingEntries.length < 50) {
                    sInfo(`[Precompute] Feed still sparse for ${userId}. Adding random discovery pool.`);
                    const discoveryRes = await pool.query(`
                        SELECT p.post_id, p.created_at, p.user_id
                        FROM posts p
                        WHERE p.visibility = 'public'
                        AND p.status = 'published'
                        AND p.user_id != $1
                        AND p.post_id != ALL($2)
                        AND p.post_id != ALL($3)
                        AND NOT EXISTS(SELECT 1 FROM likes l WHERE l.target_id = p.post_id AND l.user_id = $1)
                        ORDER BY RANDOM()
                        LIMIT 50
                    `, [userId, [...followedEntries, ...suggestedEntries, ...trendingEntries].map(e => e.post_id), seenPostIds]);

                    const discoveryEntries = discoveryRes.rows.map(row => ({
                        post_id: row.post_id,
                        score: 2,
                        source: 'discovery' as const,
                        created_at: row.created_at,
                        author_id: row.user_id
                    }));
                    trendingEntries = [...trendingEntries, ...discoveryEntries];
                }
            }

            // 4. Combine and Unique with Global Diversity Cap
            const allEntriesPool = [...followedEntries, ...suggestedEntries, ...trendingEntries];
            const globalAuthorCounts = new Map<string, number>();
            const uniqueEntriesMap = new Map();

            allEntriesPool.forEach(entry => {
                const authorId = String(entry.author_id || '');
                const count = globalAuthorCounts.get(authorId) || 0;

                // Allow only up to 5 posts per author in the entire feed pool
                if (!uniqueEntriesMap.has(entry.post_id) && count < 5) {
                    uniqueEntriesMap.set(entry.post_id, entry);
                    globalAuthorCounts.set(authorId, count + 1);
                }
            });

            finalEntries = Array.from(uniqueEntriesMap.values());
            const candidatePostIds = finalEntries.map(e => String(e.post_id));

            // 5. Apply Smart Ranking (ViT + CLIP + Text)
            // We need to fetch the user's safe mode preference first, default to 1
            const userSettingsRes = await pool.query('SELECT safe_mode FROM user_profiles WHERE user_id = $1', [userId]);
            const safeMode = userSettingsRes.rows[0]?.safe_mode ?? 1;

            const userPreferenceVectors = await this.buildUserPreferenceVectors(userId);

            if (userPreferenceVectors.visual || userPreferenceVectors.text) {
                sInfo(`[Precompute] Applying multi-modal ranking for ${userId}...`);
                const rankedCandidates = await this.rankPosts(
                    candidatePostIds,
                    userPreferenceVectors,
                    userId,
                    safeMode
                );

                // Map scores back to entries
                const scoreMap = new Map(rankedCandidates.map(r => [String(r.postId), r.score]));

                finalEntries = finalEntries.map(entry => ({
                    ...entry,
                    // Blend the original source-based score with the smart ranking score
                    // 70% Smart Score, 30% Source Heuristic
                    score: ((scoreMap.get(String(entry.post_id)) || 0) * 0.7) + ((entry.score || 0) * 0.3)
                }));

                // Re-sort by blended score
                finalEntries.sort((a, b) => b.score - a.score);
            }

            // --- Diversity Re-ranking ---
            // Improve feed variety by preventing consecutive posts from same author
            const reRanked: typeof finalEntries = [];
            const authorCounts = new Map<string, number>();
            const deferred: typeof finalEntries = [];

            // Pass 1: Add non-excessive author posts
            for (const entry of finalEntries) {
                const authorId = (entry as any).author_id;
                const count = authorCounts.get(authorId) || 0;

                if (!authorId || count < 2) {
                    reRanked.push(entry);
                    if (authorId) authorCounts.set(authorId, count + 1);
                } else {
                    deferred.push(entry);
                }
            }

            // Pass 2: Append deferred items to the end
            finalEntries = [...reRanked, ...deferred];

            // Normalize scores to preserve this diverse order in Cassandra (which sorts by score DESC)
            finalEntries = finalEntries.map((entry, index) => ({
                ...entry,
                score: 10 - (index * 0.01) // 10.0, 9.99, 9.98...
            }));

            // 6. Store in Cassandra
            if (finalEntries.length > 0) {
                await cassandraFeedRepo.cacheUserFeed(userId, finalEntries);
                sInfo(` Successfully precomputed ${finalEntries.length} items for user ${userId}`);
            } else {
                sInfo(`⚠️ No feed items to precompute for user ${userId}`);
            }

        } catch (error) {
            sError(`Critical error in precomputing feed for user ${userId}:`, error);

            // Fallback: Try to create a simple feed with just followed posts
            try {
                sInfo(`Attempting fallback feed for user ${userId}`);
                if (followedEntries.length > 0) {
                    // Use only followed posts as a basic fallback
                    // finalEntries = followedEntries.slice(0, 50); // Logic error if finalEntries is const? No it is let.
                    await cassandraFeedRepo.cacheUserFeed(userId, followedEntries.slice(0, 50));
                    sInfo(` Fallback feed created with ${followedEntries.length} posts for user ${userId}`);
                }
            } catch (fallbackError) {
                sError(`Fallback feed also failed for user ${userId}:`, fallbackError);
            }
        }
    }

    // --- Ranking Logic Moved from FeedRepository ---

    /**
     * Build user preference vectors from interaction history (multi-modal)
     */
    private async buildUserPreferenceVectors(userId: string): Promise<UserPreferenceVectors> {
        try {
            // Get user's most recent liked posts (limit to 10 for more reactivity)
            const userInteractions = await pool.query(`
            SELECT l.target_id as post_id
            FROM likes l
            WHERE l.user_id = $1 
                AND l.target_type = 'post'
            GROUP BY l.target_id
            ORDER BY MAX(l.created_at) DESC
            LIMIT 10
            `, [userId]);

            const likedPostIds = userInteractions.rows.map(row => row.post_id);

            if (likedPostIds.length === 0) {
                return { visual: null, vision: null, text: null };
            }

            // Get media IDs for liked posts
            const likedPostsMedia = await pool.query(`
            SELECT DISTINCT ON (pm.post_id) 
                pm.post_id, m.id as media_id, pm.media_order
            FROM post_media pm
            JOIN media m ON pm.media_id = m.id
            WHERE pm.post_id = ANY($1)
                AND m.status = 'ready'
                AND m.deleted_at IS NULL
            ORDER BY pm.post_id, pm.media_order
            `, [likedPostIds]);

            const mediaIds = likedPostsMedia.rows.slice(0, 10).map(row => row.media_id);

            // Try to get multi-modal vectors first
            const useMultimodal = process.env.USE_MULTIMODAL_EMBEDDINGS === 'true';

            if (useMultimodal) {
                const visualEmbeddings: number[][] = [];
                const visionEmbeddings: number[][] = [];
                const textEmbeddings: number[][] = [];

                for (const mediaId of mediaIds) {
                    const vectors = await qdrantService.getMultimodalVectors(mediaId);
                    if (vectors?.visual) {
                        visualEmbeddings.push(vectors.visual);
                    }
                    if (vectors?.vision) {
                        visionEmbeddings.push(vectors.vision);
                    }
                    if (vectors?.text) {
                        textEmbeddings.push(vectors.text);
                    }
                }

                // Average embeddings
                const avgVisual = visualEmbeddings.length > 0
                    ? this.averageVectors(visualEmbeddings)
                    : null;
                const avgVision = visionEmbeddings.length > 0
                    ? this.averageVectors(visionEmbeddings)
                    : null;
                const avgText = textEmbeddings.length > 0
                    ? this.averageVectors(textEmbeddings)
                    : null;

                return {
                    visual: avgVisual,
                    vision: avgVision,
                    text: avgText
                };
            } else {
                // Fallback to legacy vectors
                const vectorMap = await qdrantService.getMediaVectors(mediaIds);
                const embeddings: number[][] = [];

                for (const [mediaId, vector] of vectorMap.entries()) {
                    if (vector && vector.length > 0) {
                        embeddings.push(vector);
                    }
                }

                const avgVector = embeddings.length > 0
                    ? this.averageVectors(embeddings)
                    : null;

                return {
                    visual: avgVector,
                    vision: null,
                    text: null
                };
            }
        } catch (error) {
            sDebug('Error building user preference vectors:', error);
            return { visual: null, vision: null, text: null };
        }
    }

    /**
     * Rank posts using multi-signal scoring
     */
    private async rankPosts(
        candidatePostIds: string[],
        userPreferenceVectors: UserPreferenceVectors,
        userId: string,
        safeMode: number = 1
    ): Promise<RankedPostCandidate[]> {
        if (candidatePostIds.length === 0) {
            return [];
        }

        const useMultimodal = process.env.USE_MULTIMODAL_EMBEDDINGS === 'true';
        const rankedPosts: RankedPostCandidate[] = [];

        // Get post engagement data
        const engagementData = await this.getEngagementData(candidatePostIds);

        // Get post recency data
        const recencyData = await this.getRecencyData(candidatePostIds);

        // Get media IDs for posts
        const postMediaMap = await this.getPostMediaMap(candidatePostIds);

        // Track seen content types for diversity
        const seenContentTypes = new Set<string>();
        const seenUsers = new Set<string>();

        for (const postId of candidatePostIds) {
            const mediaIds = postMediaMap.get(postId) || [];
            if (mediaIds.length === 0) continue;

            // Get similarity scores
            let visualSimilarity = 0;
            let visionSimilarity = 0;
            let textSimilarity = 0;
            let contentType = 'aesthetic';

            if (useMultimodal && userPreferenceVectors.visual) {
                // Use hybrid search
                const textVector = userPreferenceVectors.text;
                const visionVector = userPreferenceVectors.vision;

                // Get vectors for first media item
                const mediaId = mediaIds[0];
                const vectors = await qdrantService.getMultimodalVectors(String(mediaId));

                if (vectors?.visual && userPreferenceVectors.visual) {
                    visualSimilarity = this.cosineSimilarity(
                        vectors.visual,
                        userPreferenceVectors.visual
                    );
                }

                if (vectors?.vision && visionVector) {
                    visionSimilarity = this.cosineSimilarity(
                        vectors.vision,
                        visionVector
                    );
                }

                if (vectors?.text && textVector) {
                    textSimilarity = this.cosineSimilarity(
                        vectors.text,
                        textVector
                    );
                }

                // Get metadata from Qdrant
                const filter = qdrantService.buildSafeFilter(safeMode);
                const searchResults = await qdrantService.searchSimilarMediaVisual(
                    userPreferenceVectors.visual,
                    1,
                    {
                        ...filter,
                        must: [
                            ...(filter?.must || []),
                            { key: 'original_media_id', match: { value: mediaId } }
                        ]
                    }
                );

                if (searchResults.length > 0) {
                    const payload = searchResults[0]?.payload;
                    contentType = String(payload?.content_type || 'aesthetic');
                }
            } else if (userPreferenceVectors.visual) {
                // Legacy: use single vector
                const mediaId = mediaIds[0];
                const vector = await qdrantService.getMediaVector(String(mediaId));

                if (vector && userPreferenceVectors.visual) {
                    visualSimilarity = this.cosineSimilarity(
                        vector,
                        userPreferenceVectors.visual
                    );
                }
            }

            // Calculate engagement score (normalized)
            const engagement = engagementData.get(postId) || { likes: 0, comments: 0, userId: '' };
            const engagementScore = this.normalizeEngagement(
                engagement.likes + engagement.comments * 2
            );

            // Calculate recency score
            const recency = recencyData.get(postId) || 0;
            const recencyScore = this.calculateRecencyScore(recency);

            // Calculate diversity score
            const diversityScore = this.calculateDiversityScore(
                contentType,
                seenContentTypes,
                seenUsers,
                engagement.userId
            );

            // Combined score
            const totalScore =
                visualSimilarity * this.rankingWeights.visual +
                visionSimilarity * this.rankingWeights.vision +
                textSimilarity * this.rankingWeights.text +
                engagementScore * this.rankingWeights.engagement +
                recencyScore * this.rankingWeights.recency +
                diversityScore * this.rankingWeights.diversity;

            rankedPosts.push({
                postId: Number(postId),
                score: totalScore,
                contentType
            });

            // Update diversity tracking
            seenContentTypes.add(contentType);
            if (engagement.userId) {
                seenUsers.add(engagement.userId);
            }
        }

        return rankedPosts;
    }

    private averageVectors(vectors: number[][]): number[] {
        if (vectors.length === 0) return [];
        const size = vectors[0]?.length || 0;
        const avg = new Array(size).fill(0);
        for (const vector of vectors) {
            for (let i = 0; i < size; i++) avg[i] += vector[i] || 0;
        }
        for (let i = 0; i < size; i++) avg[i] /= vectors.length;
        return avg;
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            const valA = a[i] || 0;
            const valB = b[i] || 0;
            dotProduct += valA * valB;
            normA += valA * valA;
            normB += valB * valB;
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private async getEngagementData(postIds: string[]): Promise<Map<string, { likes: number; comments: number; userId: string }>> {
        const result = await pool.query(`SELECT post_id, likes_count as likes, comments_count as comments, user_id FROM posts WHERE post_id = ANY($1)`, [postIds]);
        const map = new Map();
        for (const row of result.rows) map.set(String(row.post_id), { likes: row.likes || 0, comments: row.comments || 0, userId: row.user_id });
        return map;
    }

    private async getRecencyData(postIds: string[]): Promise<Map<string, number>> {
        const result = await pool.query(`SELECT post_id, EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_ago FROM posts WHERE post_id = ANY($1)`, [postIds]);
        const map = new Map();
        for (const row of result.rows) map.set(String(row.post_id), row.hours_ago || 0);
        return map;
    }

    private async getPostMediaMap(postIds: string[]): Promise<Map<string, string[]>> {
        const result = await pool.query(`SELECT pm.post_id, pm.media_id FROM post_media pm JOIN media m ON pm.media_id = m.id WHERE pm.post_id = ANY($1) AND m.status = 'ready' AND m.deleted_at IS NULL ORDER BY pm.post_id, pm.media_order`, [postIds]);
        const map = new Map<string, string[]>();
        for (const row of result.rows) {
            const id = String(row.post_id);
            const existing = map.get(id) || [];
            existing.push(row.media_id);
            map.set(id, existing);
        }
        return map;
    }

    private normalizeEngagement(engagement: number): number {
        return 1 / (1 + Math.exp(-engagement / 10));
    }

    private calculateRecencyScore(hoursAgo: number): number {
        return Math.exp(-hoursAgo / 24);
    }

    private calculateDiversityScore(contentType: string, seenContentTypes: Set<string>, seenUsers: Set<string>, userId?: string): number {
        let score = 1.0;
        if (seenContentTypes.has(contentType)) score *= 0.7;
        if (userId && seenUsers.has(userId)) score *= 0.8;
        return score;
    }

    /**
     * Trigger background computation for a user or multiple users
     */
    async triggerPrecompute(userId: string) {
        try {
            const { addFeedPrecomputeJob } = await import('../jobs/queues/feedPrecomputeQueue.js');

            // Add timeout protection for queue operations
            await Promise.race([
                addFeedPrecomputeJob(userId),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Queue timeout')), 5000)
                )
            ]);

            sDebug(`[Service] Queued precompute job for user ${userId}`);
        } catch (error) {
            sError(`[Service] Failed to queue precompute job for ${userId}:`, error);

            // Skip fallback to avoid blocking the main request
            // The next feed request will trigger precomputation if needed
            sDebug(`[Service] Skipping fallback precompute for ${userId} to avoid blocking`);
        }
    }

    /**
     * Invalidate a user's feed cache (e.g. after a follow or high-impact interaction)
     */
    async invalidateUserFeed(userId: string) {
        // Delete the cache so the next request triggers a fresh precompute
        // This ensures the new "like" is immediately factored into recommendations
        try {
            await cassandraFeedRepo.deleteUserFeedCache(userId);
            sDebug(`Feed cache invalidated for user ${userId} (will recompute on next request)`);
        } catch (error) {
            sError(`Failed to invalidate feed cache for user ${userId}:`, error);
        }
    }

    /**
     * Trigger precompute for all followers (used after a new post by a high-impact user)
     */
    async triggerForFollowers(userId: string) {
        try {
            const followersRes = await pool.query(`
                SELECT follower_id FROM follows WHERE following_id = $1 AND status = 'accepted'
                LIMIT 500 -- Limit fan-out for safety in this demo
            `, [userId]);

            for (const row of followersRes.rows) {
                this.triggerPrecompute(row.follower_id);
            }
        } catch (error) {
            sError(`Fan-out precompute failed for user ${userId}'s followers:`, error);
        }
    }
}

export default new FeedPrecomputeService();
