import { z } from 'zod';
import { paginationSchema } from './common.schemas.js';

/**
 * Search validation schemas - matches SearchController
 */

// Search posts schema
export const searchPostsSchema = {
    query: paginationSchema.extend({
        query: z.string().min(2, 'Search query must be at least 2 characters').max(200, 'Search query too long'),
        sortBy: z.enum(['relevance', 'recent', 'popular']).optional().default('relevance'),
    }),
};

// Search users schema
export const searchUsersSchema = {
    query: paginationSchema.extend({
        query: z.string().min(2, 'Search query must be at least 2 characters').max(100, 'Search query too long'),
    }),
};

// Search hashtags schema
export const searchHashtagsSchema = {
    query: paginationSchema.extend({
        query: z.string().min(1, 'Search query must be at least 1 character').max(100, 'Search query too long'),
    }),
};

// Search locations schema
export const searchLocationsSchema = {
    query: paginationSchema.extend({
        query: z.string().min(1, 'Search query must be at least 1 character').max(200, 'Search query too long'),
    }),
};

// Unified search schema
export const unifiedSearchSchema = {
    query: z.object({
        query: z.string().min(2, 'Search query must be at least 2 characters').max(200, 'Search query too long'),
    }),
};

// Search suggestions schema
export const searchSuggestionsSchema = {
    query: z.object({
        query: z.string().min(1, 'Search query is required').max(100, 'Search query too long'),
        type: z.enum(['all', 'users', 'hashtags', 'locations']).optional().default('all'),
    }),
};
