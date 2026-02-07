import { z } from 'zod';
import { captionSchema, visibilitySchema, postIdSchema, userIdSchema, paginationSchema } from './common.schemas.js';
import { postSchemas } from './index.js';

/**
 * Post validation schemas - matches PostsController
 */

// Get posts schema (with filters)
export const getPostsSchema = {
    query: paginationSchema.extend({
        userId: z.string().optional(),
        hashtag: z.string().optional(),
        type: z.enum(['photo', 'video', 'carousel']).optional(),
    }),
};

// Get post by ID schema
export const getPostByIdSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

// Create post schema
export const createPostSchema = {
    body: z.object({
        caption: captionSchema.optional(),
        postType: z.enum(['photo', 'video', 'carousel']).optional().default('photo'),
        visibility: visibilitySchema.optional().default('public'),
        location: z.string().max(200).optional(),
        mediaFiles: z.array(z.any()).optional(), // Controller expects array of objects
        hashtags: z.array(z.string().max(50)).optional(),
        status: z.string().optional(),
    }),
};

// Update post schema
export const updatePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
    body: z.object({
        caption: captionSchema.optional(),
        visibility: visibilitySchema.optional(),
        location: z.string().max(200).optional(),
    }),
};

// Delete post schema
export const deletePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

// Get saved posts schema
export const getSavedPostsSchema = {
    query: z.object({
        limit: z.string().optional().default('20').transform(Number).pipe(z.number().int().positive().max(50)),
        offset: z.string().optional().default('0').transform(Number).pipe(z.number().int().min(0)),
        collectionId: z.string().optional(),
    }),
};

// Save post schema
export const savePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
    body: z.object({
        collectionId: z.string().optional(),
    }),
};

export const unsavePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

export const removeSavedPostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};
