import { z } from 'zod';
import { captionSchema, paginationSchema, reelIdSchema, userIdSchema } from './common.schemas.js';

/**
 * Reel validation schemas - matches ReelController
 */

// Get reel feed schema
export const getReelFeedSchema = {
    query: paginationSchema,
};

// Get reels by user schema
export const getReelsByUserSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
};

// Create reel schema
export const createReelSchema = {
    body: z.object({
        caption: captionSchema.optional(),
        audioUrl: z.string().url('Invalid audio URL').optional().nullable(),
    }),
};

// Update/modify reel schema
export const modifyReelSchema = {
    params: z.object({
        reelId: reelIdSchema,
    }),
    body: z.object({
        caption: captionSchema,
    }),
};

// Delete reel schema
export const deleteReelSchema = {
    params: z.object({
        reelId: reelIdSchema,
    }),
};

// Increment reel view schema
export const incrementReelViewSchema = {
    params: z.object({
        reelId: reelIdSchema,
    }),
    body: z.object({
        watchTime: z.number().min(0).optional(),
        duration: z.number().min(0).optional(),
    }).optional(),
};

// Process reel views schema (admin/system)
export const processReelViewsSchema = {
    // No body parameters expected by controller
};
