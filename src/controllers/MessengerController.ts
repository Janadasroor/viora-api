import type { Response } from 'express';
import messengerService from '../services/MessengerService.js';
import messengerRepository from '../repositories/CassandraMessengerRepository.js';
import { sError } from 'sk-logger';
import type { AuthenticatedRequest } from '../types/api/auth.types.js';

interface StartPrivateChatBody {
  fromUsername: string;
  toUsername: string;
}

interface StartGroupChatBody {
  members: string[];
}

interface CreateConversationBody {
  members: string[];
  name?: string;
  isGroup?: boolean;
}

interface UpdateConversationBody {
  name?: string;
  members?: string[];
}

interface DeleteMessageQuery {
  deleteForEveryone?: string;
}

export const startPrivateChat = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { fromUsername, toUsername } = req.body as StartPrivateChatBody;
    if (!fromUsername || !toUsername) {
      return res.status(400).json({ success: false, error: 'Both usernames are required' });
    }

    const conversationId = await messengerService.startPrivateChat(fromUsername, toUsername);

    return res.json({ success: true, data: { conversationId } });
  } catch (error) {
    sError('Error starting private chat:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(error instanceof Error && error.message.includes('not found') ? 404 : 500)
      .json({ error: message, success: false });
  }
};

export const startGroupChat = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { members } = req.body as StartGroupChatBody;
    const userId = req.user!.userId;

    const conversation = await messengerService.createConversation(userId, members, '', true);

    return res.json({ success: true, data: { conversationId: conversation.conversationId } });
  } catch (error) {
    sError('Error starting group chat:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error', success: false });
  }
};

// Get messages for a conversation with pagination
export const getMessages = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId!;
    const limit = parseInt(req.query.limit as string) || 50;
    const cursor = req.query.cursor as string;

    const result = await messengerService.getMessages(conversationId as string, userId, limit, cursor);

    return res.json({
      success: true,
      data: result.messages,
      pagination: result.pagination
    });
  } catch (error) {
    sError('Error in getMessages:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : 500).json({ success: false, error: message });
  }
};

// Create new conversation
export const createConversation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { members, name, isGroup } = req.body as CreateConversationBody;
    const userId = req.user?.userId!;

    if (!members || members.length === 0) {
      return res.status(400).json({ success: false, error: 'Members are required' });
    }

    const conversation = await messengerService.createConversation(userId, members, name, isGroup);

    return res.status(201).json({
      success: true,
      data: conversation
    });
  } catch (error) {
    sError('Error in createConversation:', error);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
};

// Get all conversations for user
export const getConversations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const userId = req.user?.userId!;
    const conversations = await messengerService.getConversations(userId);

    return res.json({
      success: true,
      data: conversations,
      pagination: {
        count: conversations.length
      }
    });
  } catch (error) {
    sError('Error in getConversations:', error);
    return res.status(500).json({ error: (error as Error).message, success: false });
  }
};

// Get single conversation by ID
export const getConversationById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId!;

    const conversation = await messengerService.getConversationById(id as string, userId);

    return res.json({ success: true, data: conversation });
  } catch (error) {
    sError('Error in getConversationById:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : 500).json({ error: message, success: false });
  }
};

// Update conversation
export const updateConversation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { id } = req.params;
    const { name, members } = req.body as UpdateConversationBody;
    const userId = req.user?.userId!;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (members) updateData.members = members;

    await messengerService.updateConversation(id as string, userId, updateData);

    return res.json({
      success: true,
      message: 'Conversation updated successfully'
    });
  } catch (error) {
    sError('Error in updateConversation:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : (message.includes('Only admin') ? 403 : 500))
      .json({ success: false, error: message });
  }
};

// Delete conversation
export const deleteConversation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId!;

    await messengerService.deleteConversation(id as string, userId);

    return res.json({ success: true, message: 'Conversation deleted successfully' });
  } catch (error) {
    sError('Error in deleteConversation:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : (message.includes('Only admin') ? 403 : 500))
      .json({ success: false, error: message });
  }
};

// Mark message as read
export const markMessageAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { messageId } = req.params;
    const { conversationId } = req.query as { conversationId: string };
    const userId = req.user?.userId!;

    await messengerService.markMessageAsRead(conversationId as string, messageId as string, userId);

    return res.json({
      message: 'Message marked as read',
      success: true
    });
  } catch (error) {
    sError('Error in markMessageAsRead:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : 500).json({ success: false, error: message });
  }
};

export const markAllMessagesAsRead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { conversationId } = req.params;
    const userId = req.user?.userId!;

    await messengerService.markAllMessagesAsRead(conversationId as string, userId);

    return res.json({
      message: 'All messages marked as read',
      success: true
    });
  } catch (error) {
    sError('Error in markAllMessagesAsRead:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : 500).json({ success: false, error: message });
  }
};

// Delete message
export const deleteMessage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<Response> => {
  try {
    const { messageId } = req.params;
    const { conversationId } = req.query as { conversationId: string };
    const userId = req.user?.userId!;
    const { deleteForEveryone } = req.query as DeleteMessageQuery;

    await messengerService.deleteMessage(
      conversationId as string,
      messageId as string,
      userId,
      deleteForEveryone === 'true'
    );

    return res.json({
      success: true,
      message: deleteForEveryone === 'true' ? 'Message deleted for everyone' : 'Message deleted for you'
    });
  } catch (error) {
    sError('Error in deleteMessage:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(message.includes('not found') ? 404 : 500).json({ success: false, error: message });
  }
};