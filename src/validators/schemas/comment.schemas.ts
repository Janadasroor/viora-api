import { z } from 'zod';
import { commentIdSchema, paginationSchema, postIdSchema } from './common.schemas.js';

/**
 * Comment validation schemas - matches CommentsController
 */

// Get comments schema
export const getCommentsSchema = {
    params: z.object({
        targetId: z.string().min(1, 'Target ID is required'),
    }),
    query: paginationSchema.extend({
        targetType: z.enum(['post', 'reel', 'comment']),
    }),
};

// Get comment replies schema
export const getCommentRepliesSchema = {
    params: z.object({
        commentId: commentIdSchema,
    }),
    query: paginationSchema,
};

// Create post comment schema
export const createPostCommentSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
    body: z.object({
        content: z.string().min(1, 'Content is required').max(2000, 'Content too long'),
        parentCommentId: z.string().optional().nullable(),
    }),
};

// Create reel comment schema
export const createReelCommentSchema = {
    params: z.object({
        reelId: z.string().min(1, 'Reel ID is required'),
    }),
    body: z.object({
        content: z.string().min(1, 'Content is required').max(2000, 'Content too long'),
        parentCommentId: z.string().optional().nullable(),
    }),
};

// Update comment schema
export const updateCommentSchema = {
    params: z.object({
        commentId: commentIdSchema,
    }),
    body: z.object({
        content: z.string().min(1, 'Content is required').max(2000, 'Content too long'),
    }),
};

// Delete comment schema
export const deleteCommentSchema = {
    params: z.object({
        commentId: commentIdSchema,
    }),
};
