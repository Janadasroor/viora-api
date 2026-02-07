import { z } from 'zod';
import { paginationSchema, userIdSchema, usernameSchema } from './common.schemas.js';

/**
 * User validation schemas - matches UserController
 */

// Check username availability schema
export const checkUsernameAvailabilitySchema = {
    query: z.object({
        username: usernameSchema,
    }),
};

// Update profile picture schema
export const updateUserProfilePictureSchema = {
    body: z.object({
        images: z.array(z.string()).min(1, 'At least one image is required'),
    }),
};

// Update user profile schema
export const updateUserProfileSchema = {
    body: z.object({
        displayName: z.string().max(50).optional(),
        bio: z.string().max(160).optional(),
        website: z.string().url().optional().nullable(),
        location: z.string().max(100).optional(),
        birthDate: z.coerce.date().optional(),
        gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
    }),
};

// Complete user profile schema
export const completeUserProfileSchema = {
    body: z.object({
        displayName: z.string().max(50).min(1, 'Display name is required'),
        bio: z.string().max(160).optional(),
        website: z.string().url().optional().nullable(),
        location: z.string().max(100).optional(),
        birthDate: z.coerce.date().optional().refine((date) => {
            if (!date) return true; // Optional field
            const birthDate = new Date(date);
            const today = new Date();
            const age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();
            const dayDiff = today.getDate() - birthDate.getDate();

            // Calculate exact age
            const exactAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)
                ? age - 1
                : age;

            return exactAge >= 3;
        }, {
            message: 'User must be at least 3 years old'
        }),
        gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
    }),
};

// Get users schema
export const getUsersSchema = {
    query: paginationSchema.extend({
        search: z.string().optional(),
        verified: z.enum(['true', 'false']).optional(),
        status: z.enum(['active', 'inactive', 'suspended']).optional(),
    }),
};

// Get user by ID schema
export const getUserByIdSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
};

// Get user by username schema
export const getUserByUsernameSchema = {
    params: z.object({
        username: usernameSchema,
    }),
};

// Update user schema (admin/self)
export const updateUserSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
    body: updateUserProfileSchema.body,
};

// Delete user schema
export const deleteUserSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
};

// Follow/Unfollow user schema
export const followUserSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
};

// Get user profile schema
export const getUserProfileSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
};

// Get followers/following schema
export const getFollowsSchema = {
    params: z.object({
        userId: userIdSchema,
    }),
    query: paginationSchema,
};

// Get activity log schema
export const getActivityLogSchema = {
    query: paginationSchema.extend({
        type: z.enum(['like', 'comment', 'share', 'follow']).optional(),
    }),
};

