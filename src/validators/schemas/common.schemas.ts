import { z } from 'zod';

/**
 * Common reusable validation schemas
 */

// Pagination schemas
export const paginationSchema = z.object({
    page: z.string().optional().default('1').transform(Number).pipe(z.number().int().positive()),
    limit: z.string().optional().default('10').transform(Number).pipe(z.number().int().positive().max(100)),
});

// ID schemas
export const userIdSchema = z.string();
export const postIdSchema = z.string();
export const commentIdSchema = z.string();
export const reelIdSchema = z.string();
export const storyIdSchema = z.string();

// String schemas
export const emailSchema = z.string().email('Invalid email format').toLowerCase();
export const usernameSchema = z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must not exceed 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores');

export const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');

// Optional strong password (with special characters)
export const strongPasswordSchema = passwordSchema
    .regex(/[!@#$%^&*(),.?":{}|<>]/, 'Password must contain at least one special character');

// Text content schemas
export const captionSchema = z.string().max(2200, 'Caption must not exceed 2200 characters').optional();
export const commentContentSchema = z.string()
    .min(1, 'Comment cannot be empty')
    .max(500, 'Comment must not exceed 500 characters')
    .trim();

// Enum schemas
export const visibilitySchema = z.enum(['public', 'private', 'friends']);

export const sortOrderSchema = z.enum(['asc', 'desc']);

// Time range schema
export const timeRangeSchema = z.enum(['1h', '6h', '12h', '24h', '7d', '30d']);

// Media type schema
export const mediaTypeSchema = z.enum(['image', 'video', 'document']);

// URL schema
export const urlSchema = z.string().url('Invalid URL format');

// Optional nullable string
export const optionalString = z.string().optional().nullable();

// Non-empty string
export const nonEmptyString = z.string().min(1, 'Field cannot be empty').trim();
