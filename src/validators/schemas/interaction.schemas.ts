import { z } from 'zod';
import { commentIdSchema, postIdSchema, reelIdSchema, storyIdSchema } from './common.schemas.js';

/**
 * Interaction validation schemas
 */

// Like comment schema
export const likeCommentSchema = {
    params: z.object({
        commentId: commentIdSchema,
    }),
    body: z.object({
        reactionType: z.string().optional(), // Optional reaction type (e.g., 'like', 'love', etc.)
    }).optional().default({}),
};

// Unlike comment schema
export const unlikeCommentSchema = {
    params: z.object({
        commentId: commentIdSchema,
    }),
};

// Like post schema
export const likePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

// Unlike post schema
export const unlikePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

// Like reel schema
export const likeReelSchema = {
    params: z.object({
        reelId: reelIdSchema,
    }),
};

// Unlike reel schema
export const unlikeReelSchema = {
    params: z.object({
        reelId: reelIdSchema,
    }),
};

// Share post schema
export const sharePostSchema = {
    params: z.object({
        postId: postIdSchema,
    }),
};

// Like story schema
export const likeStorySchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
};

// Unlike story schema
export const unlikeStorySchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
};
