import { z } from 'zod';
import { paginationSchema, timeRangeSchema } from './common.schemas.js';

// Get feed schema
export const getFeedSchema = {
    query: paginationSchema.extend({
        safeMode: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(0).max(2)),
    }),
};

// Get trending posts schema
export const getTrendingPostsSchema = {
    query: paginationSchema.extend({
        timeRange: timeRangeSchema.optional(),
        safeMode: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(0).max(2)),
    }),
};

// Get trending hashtags schema
export const getTrendingHashtagsSchema = {
    query: z.object({
        limit: z.string().optional().default('10').transform(Number).pipe(z.number().int().positive().max(50)),
        timeRange: z.enum(['24h', '7d', '30d']).optional(),
    }),
};

// Get suggested posts schema
export const getSuggestedPostsSchema = {
    query: paginationSchema.extend({
        safeMode: z.string().optional().default('1').transform(Number).pipe(z.number().int().min(0).max(2)),
    }),
};

// Get posts by hashtag schema
export const getPostsByHashtagSchema = {
    query: paginationSchema.extend({
        hashtag: z.string().min(1, 'Hashtag is required'),
        sortBy: z.enum(['trending', 'recent', 'popular']).optional().default('trending'),
    }),
};
