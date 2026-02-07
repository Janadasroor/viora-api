import { z } from 'zod';
import { emailSchema, usernameSchema, passwordSchema } from './common.schemas.js';

/**
 * Authentication validation schemas
 */

// Login schema
export const loginSchema = {
    body: z.object({
        email: emailSchema,
        password: z.string().min(1, 'Password is required'),
    }),
};

// Register schema
export const registerSchema = {
    body: z.object({
        email: emailSchema,
        username: usernameSchema,
        password: passwordSchema,
    }),
};

// Request verification code schema
export const requestVerificationSchema = {
    body: z.object({
        email: emailSchema.optional(),
        userId: z.string().optional()
    }).refine(
        (data) => data.email || data.userId,
        { message: 'Either email or userId must be provided' }
    ),
};

// Verify email schema
export const verifyEmailSchema = {
    body: z.object({
        email: emailSchema,
        code: z.string().length(6, 'Verification code must be 6 characters'),
    }),
};

// Refresh token schema
export const refreshTokenSchema = {
    body: z.object({
        refreshToken: z.string().optional(),
    }),
};

// Logout schema
export const logoutSchema = {
    body: z.object({
        refreshToken: z.string().optional(),
    }),
};

// Request password reset schema
export const requestPasswordResetSchema = {
    body: z.object({
        email: emailSchema,
    }),
};

// Reset password schema
export const resetPasswordSchema = {
    body: z.object({
        email: emailSchema,
        code: z.string().length(6, 'Reset code must be 6 characters'),
        newPassword: passwordSchema,
    }),
};

// Change password schema
export const changePasswordSchema = {
    body: z.object({
        oldPassword: z.string().min(1, 'Old password is required'),
        newPassword: passwordSchema,
    }),
};
