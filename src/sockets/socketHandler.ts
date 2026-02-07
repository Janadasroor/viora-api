import 'dotenv/config';
import jwt from 'jsonwebtoken';
import redis from 'redis';
import * as cookie from 'cookie';
import { pool } from '../config/pg.config.js';
import type { Server as SocketIOServer } from 'socket.io';
import type { Socket as SocketIO } from 'socket.io';
import { sDebug, sError } from 'sk-logger';
import messengerRepository from '../repositories/CassandraMessengerRepository.js';
import userPresenceRepository, { type IUserPresence } from '../repositories/CassandraUserPresenceRepository.js';
import userRepository from '../repositories/UserRepository.js';
import notificationsService from '../services/NotificationsService.js';
import type { SafeUser } from '@types';

const activeUsers = new Map<string, string>(); // userId → socketId
const userRooms = new Map<string, Set<string>>(); // socketId → conversationId set
const typingUsers = new Map(); // conversationId -> Set of userIds
const redisClient = redis.createClient();
const usersOnline = new Map();

export const socketHandler = (io: SocketIOServer, socket: SocketIO) => {

  const authenticateSocket = async (token: string, socket: SocketIO, source: string) => {
    try {
      sDebug(`🔑 Attempting authentication via ${source}`);
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET as string) as SafeUser;

      const userId = decoded.userId;
      if (!userId) {
        sError(` Invalid userId in token: ${decoded.userId}`);
        throw new Error('User ID not found or invalid');
      }

      socket.join(`user_${userId}`);
      (socket as any).userId = userId;

      activeUsers.set(userId, socket.id);
      userRooms.set(socket.id, new Set());

      // Update Cassandra user online status
      const user = await userRepository.getUserById(userId);
      await userPresenceRepository.updatePresence(userId, true, {
        name: user?.username,
        email: user?.email,
        avatar: user?.media?.[0]?.filePath
      } as IUserPresence);

      // Update PostgreSQL status directly
      await pool.query('UPDATE users SET is_online = true, last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1', [userId]);

      socket.emit('authenticated', { userId });
      socket.broadcast.emit('userOnline', { userId });
      sDebug(` User authenticated successfully (${source}): ${userId}`);
      return userId;
    } catch (error: any) {
      socket.emit('authError', { error: 'Authentication failed', message: error.message });
      sError(` Authentication failed (${source}): ${error.message}`);
      throw error;
    }
  };

  // 1. Check for token in handshake.auth (explicitly passed)
  const handshakeAuthToken = socket.handshake.auth?.token;

  // 2. Check for token in handshake headers (cookies - handles httpOnly)
  const cookies = socket.handshake.headers.cookie ? cookie.parse(socket.handshake.headers.cookie) : {};
  const cookieToken = cookies.accessToken;

  const tokenToUse = handshakeAuthToken || cookieToken;
  const authSource = handshakeAuthToken ? 'handshake.auth' : (cookieToken ? 'handshake.cookie' : 'none');

  if (tokenToUse) {
    authenticateSocket(tokenToUse, socket, authSource).catch((err) => {
      sError(`⚠️ Handshake authentication failed for socket ${socket.id}: ${err.message}`);
    });
  } else {
    sDebug(`ℹ️ No token found in handshake for socket ${socket.id}`);
  }

  socket.on('authenticate', async (data: { token: string }) => {
    await authenticateSocket(data.token, socket, 'authenticate event');
  });

  // Join conversation room
  socket.on('joinRoom', async (data: { conversationId: string }) => {
    try {
      const { conversationId } = data;
      const userId = (socket as any).userId as string;

      if (!userId) {
        return socket.emit('error', { message: 'User not authenticated' });
      }

      const conversation = await messengerRepository.getConversationById(conversationId);

      if (!conversation || !conversation.members.includes(userId)) {
        return socket.emit('error', { message: 'Conversation not found or access denied' });
      }

      socket.join(conversationId);
      userRooms.get(socket.id)?.add(conversationId);

      // Mark all unread messages as delivered for this user
      const messages = await messengerRepository.getMessages(conversationId, 50, undefined);
      const undeliveredMessageIds = messages
        .filter(msg => msg.senderId !== userId && !msg.isDelivered)
        .map(msg => msg.messageId);

      if (undeliveredMessageIds.length > 0) {
        await messengerRepository.markMessagesAsDelivered(conversationId, undeliveredMessageIds, userId);

        // Notify senders that their messages were delivered
        const deliveredMessages = messages.filter(msg =>
          undeliveredMessageIds.includes(msg.messageId)
        );

        // Group by sender for efficiency
        const senderNotifications = new Map<string, string[]>();
        deliveredMessages.forEach(msg => {
          if (!senderNotifications.has(msg.senderId)) {
            senderNotifications.set(msg.senderId, []);
          }
          senderNotifications.get(msg.senderId)!.push(msg.messageId);
        });

        senderNotifications.forEach((messageIds, senderId) => {
          const senderSocketId = activeUsers.get(senderId);
          if (senderSocketId) {
            io.to(senderSocketId).emit('messagesDelivered', {
              messageIds,
              conversationId,
              deliveredBy: userId,
              deliveredAt: new Date()
            });
          }
        });
      }

      socket.emit('roomJoined', { conversationId });
      sDebug(`👤 User ${userId} joined room ${conversationId}`);
    } catch (error: any) {
      socket.emit('error', { message: error.message });
    }
  });

  // Alias for joinRoom
  socket.on('joinConversation', async (data: { conversationId: string }) => {
    socket.emit('joinRoom', data);
  });

  // Leave conversation room
  socket.on('leaveRoom', (data) => {
    const { conversationId } = data;
    socket.leave(conversationId);
    userRooms.get(socket.id)?.delete(conversationId);

    // Clear typing indicator when leaving room
    const typingSet = typingUsers.get(conversationId);
    if (typingSet) {
      typingSet.delete((socket as any).userId);
      if (typingSet.size === 0) {
        typingUsers.delete(conversationId);
      }
    }

    socket.emit('roomLeft', { conversationId });
    sDebug(`👤 User ${(socket as any).userId} left room ${conversationId}`);
  });

  // Target room joining (e.g. user_${userId})
  socket.on('join', (roomName: string) => {
    socket.join(roomName);
    sDebug(`Socket ${socket.id} joined room ${roomName}`);
  });

  socket.on('leave', (roomName: string) => {
    socket.leave(roomName);
    sDebug(`Socket ${socket.id} left room ${roomName}`);
  });

  socket.on('sendMessage', async (data: {
    conversationId: string;
    messageType: 'text' | 'image' | 'video' | 'audio' | 'file';
    content?: string;
    mediaUrl?: string;
    tempId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      const {
        conversationId,
        messageType,
        content,
        mediaUrl,
        tempId,
        metadata,
      } = data;

      const userId = (socket as any).userId as string;
      if (!userId) {
        return socket.emit('error', { message: 'User not authenticated' });
      }

      const conversation = await messengerRepository.getConversationById(conversationId);

      if (!conversation || !conversation.members.includes(userId)) {
        return socket.emit('messageError', { tempId, error: 'Access denied' });
      }
      // Validate message type
      const validMessageTypes = ['text', 'image', 'video', 'audio', 'file'];
      if (!validMessageTypes.includes(messageType)) {
        return socket.emit('messageError', { tempId, error: 'Invalid message type' });
      }

      // Ensure content/media presence
      if (messageType === 'text' && !content) {
        return socket.emit('messageError', { tempId, error: 'Text message cannot be empty' });
      }

      if (['image', 'video', 'audio', 'file'].includes(messageType) && !mediaUrl) {
        return socket.emit('messageError', { tempId, error: `${messageType} message requires mediaUrl` });
      }

      const messageData = {
        conversationId,
        senderId: userId,
        messageType,
        content: content || '',
        mediaUrl: mediaUrl || '',
        metadata: JSON.stringify(metadata || {}),
      };
      const message = await messengerRepository.createMessage(messageData);

      if (!message) {
        throw new Error('Failed to create message in Cassandra');
      }

      // Update conversation metadata
      await messengerRepository.updateConversationLastMessage(
        conversationId,
        message.messageId,
        message.createdAt,
        messageType === 'text' ? content : `Sent a ${messageType}`
      );

      // Attach sender info and transform data to match REST API format
      const senderPresence = await userPresenceRepository.getPresence(userId);

      const messageWithSender = {
        ...message,
        sender: senderPresence ? {
          userId: senderPresence.userId,
          name: senderPresence.name,
          avatar: senderPresence.avatar
        } : { userId }
      };

      // Clear typing indicator
      const typingSet = typingUsers.get(conversationId);
      if (typingSet) {
        typingSet.delete(userId);
        socket.to(conversationId).emit('userTyping', {
          userId,
          conversationId,
          isTyping: false,
        });
      }

      io.to(conversationId).emit('newMessage', { message: messageWithSender, tempId });
      sDebug(`💬 ${messageType} message sent in room ${conversationId}`);

      // Notify offline members
      const conversationMembers = await messengerRepository.getConversationById(conversationId);
      if (conversationMembers) {
        conversationMembers.members.forEach(memberId => {
          if (memberId !== userId) {
            const memberSocketId = activeUsers.get(memberId);
            // If user is not connected, OR user is connected but not in this room (optional refinement)
            // For now, let's send if they are NOT in the room or offline.
            const memberRooms = memberSocketId ? userRooms.get(memberSocketId) : null;
            const isInRoom = memberRooms?.has(conversationId);

            if (!isInRoom) {
              // Send push notification
              notificationsService.sendChatMessageNotification(
                memberId,
                messageType === 'text' ? (content || 'New message') : `Sent a ${messageType}`,
                {
                  userId: userId,
                  username: senderPresence?.name || 'User',
                  profilePicture: senderPresence?.avatar || ''
                }
              );
            }
          }
        });
      }
    } catch (error: any) {
      sError('Send message error:', error);
      socket.emit('messageError', {
        tempId: data.tempId,
        error: error.message,
      });
    }
  });

  // Upload progress for large media files
  socket.on('uploadProgress', (data: { conversationId: string; tempId: string; progress: number }) => {
    const { conversationId, tempId, progress } = data;
    const userId = (socket as any).userId as string;

    socket.to(conversationId).emit('mediaUploadProgress', {
      userId,
      tempId,
      progress,
    });
  });

  // Media upload started
  socket.on('mediaUploadStarted', (data: { conversationId: string; tempId: string; mediaType: string }) => {
    const { conversationId, tempId, mediaType } = data;
    const userId = (socket as any).userId as string;

    socket.to(conversationId).emit('userUploadingMedia', {
      userId,
      conversationId,
      tempId,
      mediaType,
      isUploading: true,
    });
  });

  // Media upload completed
  socket.on('mediaUploadCompleted', (data) => {
    const { conversationId, tempId } = data;
    socket.to(conversationId).emit('userUploadingMedia', {
      userId: (socket as any).userId,
      conversationId,
      tempId,
      isUploading: false
    });
  });

  // Video/audio recording started
  socket.on('recordingStarted', (data) => {
    const { conversationId, recordingType } = data; // 'video' or 'audio'
    socket.to(conversationId).emit('userRecording', {
      userId: (socket as any).userId,
      conversationId,
      recordingType,
      isRecording: true
    });
    sDebug(`🎥 User ${(socket as any).userId} started ${recordingType} recording in ${conversationId}`);
  });

  // Video/audio recording stopped
  socket.on('recordingStopped', (data) => {
    const { conversationId, recordingType } = data;
    socket.to(conversationId).emit('userRecording', {
      userId: (socket as any).userId,
      conversationId,
      recordingType,
      isRecording: false
    });
    sDebug(`⏹️ User ${(socket as any).userId} stopped ${recordingType} recording in ${conversationId}`);
  });

  // Typing indicator with timeout management
  socket.on('typing', (data) => {
    const { conversationId, isTyping } = data;

    if (!conversationId) return;

    if (isTyping) {
      if (!typingUsers.has(conversationId)) {
        typingUsers.set(conversationId, new Set());
      }
      typingUsers.get(conversationId).add((socket as any).userId);
    } else {
      const typingSet = typingUsers.get(conversationId);
      if (typingSet) {
        typingSet.delete((socket as any).userId);
        if (typingSet.size === 0) {
          typingUsers.delete(conversationId);
        }
      }
    }

    socket.to(conversationId).emit('userTyping', {
      userId: (socket as any).userId,
      conversationId,
      isTyping
    });
  });

  // Comment typing indicator
  socket.on('commentTyping', (data) => {
    const { targetId, targetType, isTyping } = data;
    const roomName = `${targetType}_${targetId}`;

    socket.to(roomName).emit('userTypingComment', {
      userId: (socket as any).userId,
      targetId,
      targetType,
      isTyping
    });
  });

  // Mark message as read
  socket.on('markAsRead', async (data) => {
    try {
      const { messageId, conversationId } = data;
      const userId = (socket as any).userId as string;

      if (!userId) return;

      await messengerRepository.markMessageAsRead(conversationId, messageId, userId);

      io.to(conversationId).emit('messageRead', {
        messageId,
        userId,
        readAt: new Date()
      });
    } catch (error) {
      sError('Mark as read error:', error);
    }
  });

  // Mark message as delivered
  socket.on('markMessageAsDelivered', async (data) => {
    try {
      const { messageId, conversationId } = data;
      const userId = (socket as any).userId as string;

      if (!userId) return;

      await messengerRepository.markMessageAsDelivered(conversationId, messageId, userId);

      // Notify sender that message was delivered
      const message = await messengerRepository.getMessageById(conversationId, messageId);
      if (message) {
        const senderSocketId = activeUsers.get(message.senderId);
        if (senderSocketId) {
          io.to(senderSocketId).emit('messageDelivered', {
            messageId,
            conversationId,
            deliveredBy: userId,
            deliveredAt: new Date()
          });
        }
      }
    } catch (error) {
      sError('Mark message as delivered error:', error);
    }
  });

  // Mark multiple messages as delivered (bulk operation)
  socket.on('markMessagesAsDelivered', async (data) => {
    try {
      const { messageIds, conversationId } = data;
      const userId = (socket as any).userId as string;

      if (!userId || !messageIds || !Array.isArray(messageIds)) return;

      await messengerRepository.markMessagesAsDelivered(conversationId, messageIds, userId);

      // Notify sender that messages were delivered
      io.to(conversationId).emit('messagesDelivered', {
        messageIds,
        userId,
        deliveredAt: new Date()
      });
    } catch (error) {
      sError('Mark messages as delivered error:', error);
    }
  });

  // Mark multiple messages as read (bulk operation)
  socket.on('markMessagesAsRead', async (data) => {
    try {
      const { messageIds, conversationId } = data;
      const userId = (socket as any).userId as string;

      if (!userId || !messageIds || !Array.isArray(messageIds)) return;

      await messengerRepository.markMessagesAsRead(conversationId, messageIds, userId);

      io.to(conversationId).emit('messagesRead', {
        messageIds,
        userId,
        readAt: new Date()
      });
    } catch (error) {
      sError('Mark messages as read error:', error);
    }
  });

  // Delete message
  socket.on('deleteMessage', async (data: { messageId: string; conversationId: string; deleteForEveryone?: boolean }) => {
    try {
      const { messageId, conversationId, deleteForEveryone = true } = data;
      const userId = (socket as any).userId as string;

      if (!userId) {
        return socket.emit('error', { message: 'User not authenticated' });
      }

      const message = await messengerRepository.getMessageById(conversationId, messageId);

      if (!message) {
        return socket.emit('error', { message: 'Message not found' });
      }

      if (deleteForEveryone) {
        if (message.senderId !== userId) {
          return socket.emit('error', { message: 'Only sender can delete for everyone' });
        }
        await messengerRepository.deleteMessage(conversationId, messageId);
        io.to(conversationId).emit('messageDeleted', {
          messageId,
          conversationId,
          deletedBy: userId,
          forEveryone: true
        });
      } else {
        await messengerRepository.markMessageAsDeletedForUser(conversationId, messageId, userId);
        socket.emit('messageDeleted', {
          messageId,
          conversationId,
          deletedBy: userId,
          forEveryone: false
        });
      }

      sDebug(`🗑️ Message ${messageId} deleted by user ${userId} (forEveryone: ${deleteForEveryone})`);
    } catch (error: any) {
      sError('Delete message error:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // React to message (emoji reactions)
  socket.on('reactToMessage', async (data) => {
    try {
      const { messageId, conversationId, reaction } = data;
      const userId = (socket as any).userId as string;

      if (!userId) return;

      await messengerRepository.reactToMessage(conversationId, messageId, userId, reaction);

      io.to(conversationId).emit('messageReaction', {
        messageId,
        userId,
        reaction,
        reactedAt: new Date()
      });
    } catch (error) {
      sError('React to message error:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      const userId = (socket as any).userId;

      if (userId) {
        activeUsers.delete(userId);
        usersOnline.delete(userId);

        // Clear all typing indicators for this user
        for (const [conversationId, typingSet] of typingUsers.entries()) {
          if (typingSet.has(userId)) {
            typingSet.delete(userId);
            io.to(conversationId).emit('userTyping', {
              userId,
              conversationId,
              isTyping: false
            });
          }
          if (typingSet.size === 0) {
            typingUsers.delete(conversationId);
          }
        }

        // Update Cassandra & SQL user status
        await userPresenceRepository.updatePresence(userId, false);
        await pool.query(
          'UPDATE users SET is_online = false, last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1',
          [userId]
        );
        await pool.query(
          'UPDATE user_profiles SET updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
          [userId]
        );

        socket.broadcast.emit('userOffline', { userId, lastSeen: new Date() });
        userRooms.delete(socket.id);

        sDebug(`🔌 User disconnected: ${userId}`);
      }
    } catch (error) {
      sError('Disconnect error:', error);
    }
  });

  // Voice call signaling
  const handleVoiceCall = (event: string, payload: any) => {
    const targetSocketId = activeUsers.get(payload.targetUserId);
    if (!targetSocketId) return socket.emit('callError', { error: 'User is offline' });
    io.to(targetSocketId).emit(event, { ...payload, userId: (socket as any).userId });
  };

  socket.on('voiceCallOffer',
    async (data) => {
      sDebug('🎤 Received voiceCallOffer event!', JSON.stringify(data));
      handleVoiceCall('voiceCallOffered', data);
    }
  );
  socket.on('voiceCallAnswer', (data) => handleVoiceCall('voiceCallAnswered', data));
  socket.on('voiceCallIceCandidate', (data) => handleVoiceCall('voiceCallIceCandidate', data));
  socket.on('voiceCallReject', (data) => handleVoiceCall('voiceCallRejected', data));
  socket.on('voiceCallEnd', (data) => handleVoiceCall('voiceCallEnded', data));

  socket.on('message', async (message) => {
    try {
      const userId = (socket as any).userId;
      const data = JSON.parse(message);
      if (data.action === 'online') {
        await userPresenceRepository.updatePresence(userId, true);
        await setUserStatus(userId, true);
      } else if (data.action === 'offline') {
        await userPresenceRepository.updatePresence(userId, false);
        await setUserStatus(userId, false);
      }
    } catch (e) {
      sError('Invalid message:', e);
    }
  });

};

async function setUserStatus(userId: string, isOnline: boolean) {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    if (isOnline) {
      await redisClient.set(`user:${userId}:online`, '1');
    } else {
      await redisClient.del(`user:${userId}:online`);
    }
  } catch (e) {
    sError('Failed to update user status:', e);
  }
}

// Optional: batch persist to PostgreSQL periodically
async function persistOnlineStatus() {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    const keys = await redisClient.keys('user:*:online');
    const userIds = keys.map(k => k.split(':')[1]).filter(id => id);

    // Reset all users to offline
    await pool.query('UPDATE users SET is_online = false');
    await pool.query('UPDATE user_profiles SET is_online = false');

    // Set online users to true
    if (userIds.length) {
      await pool.query(
        'UPDATE users SET is_online = true WHERE user_id = ANY($1)',
        [userIds]
      );
      await pool.query(
        'UPDATE user_profiles SET is_online = true WHERE user_id = ANY($1)',
        [userIds]
      );
      sDebug('PostgreSQL presence updated');
    }
  } catch (e) {
    sError('Failed to persist to PostgreSQL:', e);
  }
}

// Run persistence every 10 seconds
setInterval(persistOnlineStatus, 10_000);
