import type { Notification, NotificationData, NotificationWithActor, UnreadCount } from '@types';
import { sError } from 'sk-logger';
import { getIO } from '../utils/socketManager.js';
import notificationsRepository from '../repositories/NotificationsRepository.js';
import { sendPushNotification } from '../utils/notificationsSender.js';

interface CreateNotificationData {
  recipientId: string;
  actorId: string;
  notificationType: NotificationType;
  targetType: string;
  targetId: string;
  message?: string;
  sendPush?: boolean;
  useAggregation?: boolean;
}

interface NotifyParams extends CreateNotificationData {
  // message is optional here as we can generate it
}


interface FormattedNotification {
  notificationId: string;
  recipientId: string;
  actorId: string;
  notificationType: string;
  targetType?: string | null;
  targetId?: string | null;
  message: string;
  isRead: boolean | null;
  createdAt: Date | null;
  readAt?: Date | null;
  actor: {
    username?: string | null;
    profilePicture?: string | null;
  };
}

interface PaginatedNotifications {
  notifications: FormattedNotification[];
  page: number;
  limit: number;
}

type NotificationType = 'like' | 'comment' | 'follow' | 'mention' | 'story_view' | 'direct_message' | 'post_share' | 'story_share' | 'share' | 'comment_reply' | 'follow_request' | 'live_video' | 'new_post' | 'new_reel' | 'new_story' | 'profile_update' | 'mediaReady';

class NotificationsService {
  /**
   * Main entry point for sending notifications.
   * Handles both immediate creation and aggregation buffering.
   */
  async notify(params: NotifyParams): Promise<void> {
    const {
      recipientId,
      actorId,
      notificationType,
      targetType,
      targetId,
      message,
      sendPush = true,
      useAggregation = false
    } = params;

    // Use aggregation if requested and supported
    if (useAggregation && ['like', 'comment', 'new_post', 'new_reel', 'new_story'].includes(notificationType)) {
      const redisService = (await import('../cache/RedisService.js')).default;
      await redisService.addToNotificationAggregation(
        recipientId,
        actorId,
        targetType,
        targetId,
        notificationType as any
      );
      return;
    }

    // Otherwise create direct notification
    const finalMessage = message || this.generateNotificationMessage(notificationType, targetType);
    await this.createNotification({
      recipientId,
      actorId,
      notificationType,
      targetType,
      targetId,
      message: finalMessage,
      sendPush
    });
  }

  /**
   * Create a notification and optionally send push
   */
  async createNotification(data: CreateNotificationData): Promise<Notification> {
    const {
      recipientId,
      actorId,
      notificationType,
      targetType,
      targetId,
      message,
      sendPush = true
    } = data;

    if (!recipientId || !actorId || !notificationType || !targetType || !targetId || !message) {
      throw new Error('Missing required fields for notification creation');
    }

    // Create notification in database
    const notification = await notificationsRepository.create({
      recipientId,
      actorId,
      notificationType,
      targetType,
      targetId,
      message
    });

    // Send push notification if enabled
    if (sendPush) {
      this.sendDirectPush(recipientId, notificationType, message).catch(err => sError('Push failed:', err));
    }

    // Emit via socket immediately
    this.emitNewNotification(recipientId, notification);

    return notification;
  }

  private async sendDirectPush(recipientId: string, type: string, message: string) {
    try {
      const fcmToken = await notificationsRepository.getUserFcmToken(recipientId);
      if (fcmToken) {
        await sendPushNotification(
          fcmToken,
          this.getNotificationTitle(type),
          message
        );
      }
    } catch (error) {
      sError('Failed to send push notification:', error);
    }
  }

  private emitNewNotification(recipientId: string, notification: any) {
    try {
      const io = getIO();
      if (io) {
        io.to(`user_${recipientId}`).emit('notification', {
          id: notification.notificationId,
          type: notification.notificationType,
          message: notification.message,
          targetType: notification.targetType,
          targetId: notification.targetId,
          createdAt: notification.createdAt
        });
      }
    } catch (error) {
      sError('Error emitting new notification:', error);
    }
  }


  /**
   * Get notifications for a user with pagination
   */
  async getUserNotifications(
    recipientId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedNotifications> {
    const offset = (page - 1) * limit;
    const notifications = await notificationsRepository.getByRecipientId(
      recipientId,
      parseInt(String(limit)),
      parseInt(String(offset))
    );

    // Import redisService dynamically to avoid circular dependency
    const redisService = (await import('../cache/RedisService.js')).default;

    // Convert isRead to boolean and format response
    const formatted: FormattedNotification[] = await Promise.all(
      notifications.map(async (n) => {
        // Fetch aggregation metadata from Redis
        const metadata = await redisService.getNotificationMetadata(n.notificationId);

        return {
          notificationId: n.notificationId,
          recipientId: n.recipientId,
          actorId: n.actorId,
          notificationType: n.notificationType,
          targetType: n.targetType,
          targetId: n.targetId,
          message: n.message,
          isRead: !!n.isRead,
          createdAt: n.createdAt,
          readAt: n.readAt,
          actor: {
            username: n.actorUsername,
            profilePicture: (n.actorProfilePicture || (n.actorUserMedia && n.actorUserMedia.length > 0 ? n.actorUserMedia[0]?.filePath : null)) ?? null
          },
          // Add aggregation metadata if available
          aggregation: metadata ? {
            count: metadata.count,
            actorIds: metadata.actorIds,
            sampleActors: metadata.sampleActors
          } : null
        };
      })
    );

    return {
      notifications: formatted,
      page: parseInt(String(page)),
      limit: parseInt(String(limit))
    };
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(recipientId: string): Promise<{ count: number }> {
    const count = await notificationsRepository.getUnreadCount(recipientId);
    return { count };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, recipientId: string): Promise<Notification> {
    const notification = await notificationsRepository.markAsRead(notificationId, recipientId);

    if (!notification) {
      throw new Error('Notification not found or unauthorized');
    }

    return notification;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(recipientId: string): Promise<{ count: number }> {
    const notifications = await notificationsRepository.markAllAsRead(recipientId);
    return { count: notifications.length };
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, recipientId: string): Promise<Boolean> {
    const deleted = await notificationsRepository.delete(notificationId, recipientId);

    if (!deleted) {
      throw new Error('Notification not found or unauthorized');
    }

    return deleted;
  }

  /**
   * Delete all notifications
   */
  async deleteAllNotifications(recipientId: string): Promise<{ count: number }> {
    const notifications = await notificationsRepository.deleteAll(recipientId);
    return { count: notifications.length };
  }

  /**
   * Update FCM token
   */
  async updateFcmToken(userId: string, token: string): Promise<any> {
    const result = await notificationsRepository.updateFcmToken(userId, token);

    if (!result) {
      throw new Error('User not found');
    }

    return result;
  }

  /**
   * Helper method to get notification title based on type
   */
  getNotificationTitle(notificationType: string): string {
    const titles: Record<string, string> = {
      like: 'New Like',
      comment: 'New Comment',
      follow: 'New Follower',
      mention: 'You were mentioned',
      story_view: 'New Story View',
      direct_message: 'New Message',
      post_share: 'Post Shared',
      story_share: 'Story Shared',
      comment_reply: 'Comment Reply',
      follow_request: 'New Follow Request',
      live_video: 'Live Video Started',
      new_post: 'New Post',
      new_reel: 'New Reel',
      new_story: 'New Story',
      mediaReady: 'Media Processing Ready',
      profile_update: 'Profile Updated',
      default: 'New Notification'
    };

    return titles[notificationType] || titles.default || 'New Notification';
  }

  /**
   * Send test notification
   */
  async sendTestNotification(
    token: string,
    title: string,
    message: string
  ): Promise<{ success: boolean }> {
    if (!token) {
      throw new Error('FCM token is required');
    }

    await sendPushNotification(token, title, message);
    return { success: true };
  }

  /**
   * Send chat message notification
   */
  async sendChatMessageNotification(
    recipientId: string,
    message: string,
    sender: { userId: string; username?: string; profilePicture?: string }
  ): Promise<void> {
    try {
      const fcmToken = await notificationsRepository.getUserFcmToken(recipientId);
      if (!fcmToken) return;

      const title = sender.username || 'New Message';
      const body = message.length > 50 ? message.substring(0, 50) + '...' : message;

      await sendPushNotification(fcmToken, title, body, {
        type: 'chat',
        senderId: sender.userId,
        senderName: sender.username || 'Unknown',
        senderAvatar: sender.profilePicture || ''
      });
    } catch (error) {
      sError('Failed to send chat notification:', error);
    }
  }

  /**
   * Process a batch of buffered interactions for aggregation
   * Logic moved from notificationAggregationWorker
   */
  async processAggregationBatch(batch: any): Promise<void> {
    const { recipientId, targetType, targetId, notificationType, actors, redisKey } = batch;
    const redisService = (await import('../cache/RedisService.js')).default;

    try {
      // Check if recent notification exists (within last 5 minutes)
      const existingNotif = await notificationsRepository.findRecentAggregatedNotification(
        recipientId,
        targetType,
        targetId,
        notificationType,
        5
      );

      const actorIds: string[] = actors.map((a: any) => a.actorId);
      const uniqueActorIds = [...new Set(actorIds)];

      if (existingNotif) {
        // UPDATE existing notification
        const existingMetadata = await redisService.getNotificationMetadata(existingNotif.notificationId);
        const existingActorIds = existingMetadata?.actorIds || [existingNotif.actorId];

        // Merge actor IDs
        const updatedActorIds = [...new Set([...existingActorIds, ...uniqueActorIds])];
        const sampleActors = updatedActorIds.slice(0, 3);

        const message = await this.generateAggregatedMessage(
          notificationType,
          updatedActorIds.length,
          sampleActors,
          targetType
        );

        // Update DB
        await notificationsRepository.updateAggregatedNotification(
          existingNotif.notificationId,
          message
        );

        // Update Redis Metadata
        await redisService.setNotificationMetadata(
          existingNotif.notificationId,
          updatedActorIds,
          updatedActorIds.length,
          sampleActors
        );

        // Send Push
        await this.sendAggregatedPush(recipientId, notificationType, message);

        // Emit Socket Update
        this.emitNotificationUpdate(recipientId, existingNotif.notificationId, updatedActorIds.length);

      } else {
        // CREATE new aggregated notification
        const sampleActors = uniqueActorIds.slice(0, 3);
        const message = await this.generateAggregatedMessage(
          notificationType,
          uniqueActorIds.length,
          sampleActors,
          targetType
        );

        const notification = await notificationsRepository.create({
          recipientId,
          actorId: uniqueActorIds[0] || 'system',
          notificationType,
          targetType,
          targetId,
          message: message || ''
        });

        // Store metadata in Redis
        await redisService.setNotificationMetadata(
          notification.notificationId,
          uniqueActorIds,
          uniqueActorIds.length,
          sampleActors
        );

        // Send push notification
        await this.sendAggregatedPush(recipientId, notificationType, message);

        // Emit Socket event
        this.emitNewNotification(recipientId, notification);
      }

      // Clear from Redis buffer
      await redisService.clearNotificationAggregation(redisKey, recipientId);

    } catch (error) {
      sError(`Error processing notification aggregation for ${targetType} ${targetId}:`, error);
    }
  }

  private async sendAggregatedPush(recipientId: string, type: string, message: string) {
    try {
      const fcmToken = await notificationsRepository.getUserFcmToken(recipientId);
      if (fcmToken) {
        await sendPushNotification(fcmToken, `New ${type}`, message);
      }
    } catch (error) {
      sError('Failed to send aggregated push notification:', error);
    }
  }

  private emitNotificationUpdate(recipientId: string, notificationId: string, count: number) {
    try {
      const io = getIO();
      if (io) {
        io.to(`user_${recipientId}`).emit('notification_updated', {
          notificationId,
          count,
          updatedAt: new Date()
        });
      }
    } catch (error) {
      sError('Error emitting notification update:', error);
    }
  }

  /**
   * Internal helper to generate a default message for notifications
   */
  private generateNotificationMessage(type: string, targetType: string): string {
    const messages: Record<string, string> = {
      like: `liked your ${targetType}`,
      comment: `commented on your ${targetType}`,
      mention: `mentioned you in a ${targetType}`,
      follow: `started following you`,
      story_view: `viewed your story`
    };
    return messages[type] || `interacted with your ${targetType}`;
  }

  /**
   * Internal helper for aggregated message generation
   */
  private async generateAggregatedMessage(
    type: string,
    count: number,
    sampleActorIds: string[],
    targetType: string
  ): Promise<string> {
    const fetchedUsernames = await notificationsRepository.getUsernames(sampleActorIds);
    const actors = [...new Set(fetchedUsernames)].filter(name => name);

    let action = '';
    let suffix = `your ${targetType}`;

    if (type === 'like') action = 'liked';
    else if (type === 'comment') action = 'commented on';
    else if (type === 'new_post') { action = 'created a new'; suffix = 'post'; }
    else if (type === 'new_reel') { action = 'created a new'; suffix = 'reel'; }
    else if (type === 'new_story') { action = 'added to their'; suffix = 'story'; }

    const effectiveCount = Math.max(count, actors.length);

    if (actors.length === 0) {
      return `Someone ${action} ${suffix}`;
    }

    if (effectiveCount === 1) {
      return `${actors[0]} ${action} ${suffix}`;
    } else if (effectiveCount === 2) {
      return `${actors[0]} and ${actors[1]} ${action} ${suffix}`;
    } else {
      const others = effectiveCount - 2;
      return `${actors[0]}, ${actors[1]}, and ${others} ${others === 1 ? 'other' : 'others'} ${action} ${suffix}`;
    }
  }
}

export default new NotificationsService();