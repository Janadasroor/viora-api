import { z } from 'zod';
import { paginationSchema } from './common.schemas.js';

/**
 * Update FCM Token Schema
 */
export const updateFcmTokenSchema = {
    body: z.object({
        token: z.string().min(1, 'FCM token is required'),
    }),
};

/**
 * Send Test Notification Schema
 */
export const sendTestNotificationSchema = {
    body: z.object({
        token: z.string().min(1, 'FCM token is required'),
        title: z.string().min(1, 'Title is required'),
        message: z.string().min(1, 'Message is required'),
    }),
};

/**
 * Create Notification Schema
 */
export const createNotificationSchema = {
    body: z.object({
        recipientId: z.string().min(1, 'Recipient ID is required'),
        actorId: z.string().min(1, 'Actor ID is required'),
        notificationType: z.string().min(1),
        targetType: z.string().optional(),
        targetId: z.string().optional(),
        message: z.string().optional(),
        sendPush: z.boolean().optional().default(true),
    }),
};

/**
 * Get Notifications Schema
 */
export const getNotificationsSchema = {
    query: paginationSchema,
};

/**
 * Notification ID Params Schema
 */
export const notificationIdSchema = {
    params: z.object({
        id: z.string().min(1, 'Notification ID is required'),
    }),
};
