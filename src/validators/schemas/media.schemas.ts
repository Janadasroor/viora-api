import { z } from 'zod';
import { paginationSchema } from './common.schemas.js';

/**
 * Media validation schemas - matches MediaController
 */

// Get media schema
export const getMediaSchema = {
    query: z.object({
        type: z.enum(['image', 'video', 'all']).optional().default('image'),
        page: z.string().optional().default('1').transform(Number).pipe(z.number().int().positive()),
        limit: z.string().optional().default('10').transform(Number).pipe(z.number().int().positive().max(100)),
    }),
};

// Delete media schema
export const deleteMediaSchema = {
    params: z.object({
        id: z.string().min(1, 'Media ID is required'),
    }),
};

// Upload images schema (multipart form data - validated in controller)
// Note: File validation happens in multer middleware and controller
export const uploadImagesSchema = {
    body: z.object({
        title: z.string().max(200).optional(),
        description: z.string().max(2200).optional(),
    }).optional().default({}),
    query: z.object({
        postId: z.string().optional(),
        targetType: z.enum(['POST', 'REEL', 'STORY', 'USER']),
    }),
};

// Upload video schema (multipart form data - validated in controller)
export const uploadVideoSchema = {
    body: z.object({
        title: z.string().max(200).optional(),
        description: z.string().max(2200).optional(),
    }).optional().default({}),
    query: z.object({
        postId: z.string(), //This represents the target id reel | post | story |user you can change it later to targetId
        targetType: z.enum(['POST', 'REEL', 'STORY', 'USER'])
    }),
};
