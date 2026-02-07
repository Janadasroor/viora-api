import { z } from 'zod';
import { paginationSchema } from './common.schemas.js';

/**
 * Start Private Chat Schema
 */
export const startPrivateChatSchema = {
    body: z.object({
        fromUsername: z.string().min(1, 'fromUsername is required'),
        toUsername: z.string().min(1, 'toUsername is required'),
    }),
};

/**
 * Start Group Chat Schema
 */
export const startGroupChatSchema = {
    body: z.object({
        members: z.array(z.string()).min(1, 'At least one member is required'),
    }),
};

/**
 * Get Messages Schema
 */
export const getMessagesSchema = {
    params: z.object({
        conversationId: z.string().min(1, 'Conversation ID is required'),
    }),
    query: paginationSchema,
};

/**
 * Message ID Params Schema
 */
export const messageIdSchema = {
    params: z.object({
        messageId: z.string().min(1, 'Message ID is required'),
    }),
};

/**
 * Delete Message Schema
 */
export const deleteMessageSchema = {
    params: z.object({
        messageId: z.string().min(1, 'Message ID is required'),
    }),
    query: z.object({
        deleteForEveryone: z.enum(['true', 'false']).optional(),
    }),
};

/**
 * Conversation ID Params Schema
 */
export const conversationIdSchema = {
    params: z.object({
        conversationId: z.string().min(1, 'Conversation ID is required'),
    }),
};

/**
 * Create Conversation Schema
 */
export const createConversationSchema = {
    body: z.object({
        members: z.array(z.string()).min(1, 'Members are required'),
        name: z.string().optional(),
        isGroup: z.boolean().optional(),
    }),
};

/**
 * Update Conversation Schema
 */
export const updateConversationSchema = {
    params: z.object({
        conversationId: z.string().min(1, 'Conversation ID is required'),
    }),
    body: z.object({
        name: z.string().optional(),
        members: z.array(z.string()).optional(),
    }),
};

/**
 * Get Conversations Schema
 */
export const getConversationsSchema = {
    query: paginationSchema,
};
