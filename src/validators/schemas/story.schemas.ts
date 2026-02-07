import { z } from 'zod';
import { paginationSchema, storyIdSchema, userIdSchema } from './common.schemas.js';

/**
 * Story validation schemas
 */

// Text overlay item schema
const textOverlayItemSchema = z.object({
    id: z.string(),
    text: z.string().max(500),
    font: z.object({
        family: z.string().optional(),
        size: z.number().positive().optional(),
        weight: z.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).optional(), // Hex color with optional alpha
    }).optional(),
    style: z.object({
        backgroundColor: z.string().optional(),
        letterSpacing: z.number().optional(),
        lineHeight: z.number().positive().optional(),
    }).optional(),
    transform: z.object({
        position: z.object({
            x: z.number().min(0).max(1), // Normalized 0-1
            y: z.number().min(0).max(1),
        }),
        scale: z.number().positive().optional().default(1.0),
        rotation: z.number().optional().default(0), // Degrees
    }).optional(),
    shadow: z.object({
        color: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).optional(),
        blur: z.number().min(0).optional(),
        dx: z.number().optional(),
        dy: z.number().optional(),
    }).optional(),
    animation: z.object({
        type: z.enum(['none', 'fade', 'slide', 'bounce', 'zoom']).optional().default('none'),
        durationMs: z.number().min(0).optional().default(0),
    }).optional(),
});

// Sticker item schema
const stickerItemSchema = z.object({
    id: z.string(),
    type: z.enum(['image', 'emoji', 'gif']),
    src: z.string().url().optional(), // URL for image/gif stickers
    emoji: z.string().optional(), // For emoji type
    transform: z.object({
        position: z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
        }),
        scale: z.number().positive().optional().default(1.0),
        rotation: z.number().optional().default(0),
    }),
    opacity: z.number().min(0).max(1).optional().default(1.0),
    zIndex: z.number().int().optional().default(1),
    animation: z.object({
        type: z.enum(['none', 'bounce', 'spin', 'pulse', 'shake']).optional().default('none'),
        durationMs: z.number().min(0).optional().default(0),
    }).optional(),
    meta: z.object({
        isPremium: z.boolean().optional().default(false),
    }).optional(),
});

// Create story schema - matches StoryData interface
export const createStorySchema = {
    body: z.object({
        storyType: z.enum(['photo', 'video', 'text']).optional().default('photo'),
        content: z.string().max(500, 'Content must not exceed 500 characters').optional().nullable(),
        backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional().nullable(),
        textOverlay: z.array(textOverlayItemSchema).optional().nullable(),
        stickers: z.array(stickerItemSchema).optional().nullable(),
        musicId: z.string().optional().nullable(),
        visibility: z.enum(['public', 'private', 'friends', 'close_friends']).optional().default('public'),
        status: z.string().optional(),
    }),
};

// Get stories schema (user's own stories)
export const getStoriesSchema = {
    query: paginationSchema.extend({
        userId: z.string().optional(),
        includeExpired: z.enum(['true', 'false']).optional().default('false'),
    }),
};

// Get following stories schema
export const getFollowingStoriesSchema = {
    query: z.object({
        page: z.string().optional().default('1').transform(Number).pipe(z.number().int().positive()),
        limit: z.string().optional().default('20').transform(Number).pipe(z.number().int().positive().max(100)),
    }),
};

// Get story views schema
export const getStoryViewsSchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
    query: paginationSchema,
};

// Delete story schema
export const deleteStorySchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
};

// View story schema (for marking as viewed)
export const viewStorySchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
    body: z.object({
        watchDuration: z.number().int().min(0).max(30).optional(),
    }).optional(),
};

// Update story schema
export const updateStorySchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
    body: z.object({
        textOverlay: z.array(textOverlayItemSchema).optional().nullable(),
        visibility: z.enum(['public', 'private', 'friends', 'close_friends']).optional(),
        content: z.string().max(500, 'Content must not exceed 500 characters').optional().nullable(),
        backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format').optional().nullable(),
        stickers: z.array(stickerItemSchema).optional().nullable(),
        musicId: z.string().optional().nullable(),
    }),
};

// Get story by ID schema
export const getStoryByIdSchema = {
    params: z.object({
        storyId: storyIdSchema,
    }),
};
