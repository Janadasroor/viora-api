import { pool } from '../config/pg.config.js';
import type { QueryResult } from 'pg';
import type { Notification, NotificationData, NotificationWithActor, UnreadCount } from '@types';
import { sError } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';
import mediaRepository from './MediaRepository.js';

import snowflakeService from "../services/SnowflakeService.js";

class NotificationsRepository {
  /**
   * Create a new notification
   */
  async create(notificationData: NotificationData): Promise<Notification> {
    const { recipientId, actorId, notificationType, targetType, targetId, message } = notificationData;

    const notificationId = snowflakeService.generate();

    const result = await pool.query(
      `INSERT INTO notifications (notification_id, recipient_id, actor_id, notification_type, target_type, target_id, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING notification_id, recipient_id, actor_id, notification_type, target_type, target_id, message, is_read, created_at, read_at`,
      [notificationId, recipientId, actorId, notificationType, targetType, targetId, message]
    );
    if (!result.rows[0]) throw new Error('Failed to create notification');
    return toCamel(result.rows[0]);
  }

  /**
   * Get notifications for a user with pagination
   */
  async getByRecipientId(recipientId: string, limit: number = 20, offset: number = 0): Promise<NotificationWithActor[]> {
    const result = await pool.query(
      `SELECT 
        n.notification_id,
        n.recipient_id,
        n.actor_id,
        n.notification_type,
        n.target_type,
        n.target_id,
        n.message,
        n.is_read,
        n.created_at,
        n.read_at,
        u.username as actor_username
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.user_id
       WHERE n.recipient_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [recipientId, limit, offset]
    );

    const notifications = result.rows;

    if (notifications.length > 0) {
      // Fetch user media for actors
      const actorIds = [...new Set(notifications.map(n => n.actor_id))];
      const userMediaMap = await mediaRepository.getUsersMedia(actorIds);

      notifications.forEach(notification => {
        (notification as any).actor_user_media = userMediaMap[notification.actor_id] || [];
      });
    }

    return toCamel(notifications);
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(recipientId: string): Promise<number> {
    const result: QueryResult<UnreadCount> = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE recipient_id = $1 AND is_read = FALSE`,
      [recipientId]
    );
    if (result.rows[0] == undefined) return 0;
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId: string, recipientId: string): Promise<Notification | undefined> {
    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = TRUE, read_at = NOW() 
       WHERE notification_id = $1 AND recipient_id = $2
       RETURNING *`,
      [notificationId, recipientId]
    );

    return toCamel(result.rows[0]);
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(recipientId: string): Promise<{ notification_id: string }[]> {
    const result = await pool.query(
      `UPDATE notifications 
       SET is_read = TRUE, read_at = NOW() 
       WHERE recipient_id = $1 AND is_read = FALSE
       RETURNING notification_id`,
      [recipientId]
    );

    return toCamel(result.rows);
  }

  /**
   * Delete a notification
   */
  async delete(notificationId: string, recipientId: string): Promise<Boolean> {
    const result = await pool.query(
      `DELETE FROM notifications 
       WHERE notification_id = $1 AND recipient_id = $2
       RETURNING notification_id`,
      [notificationId, recipientId]
    );

    return true;
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAll(recipientId: string): Promise<{ notificationId: string }[]> {
    const result = await pool.query(
      `DELETE FROM notifications 
       WHERE recipient_id = $1
       RETURNING notification_id`,
      [recipientId]
    );

    return toCamel(result.rows);
  }

  /**
   * Get a single notification by ID
   */
  async getById(notificationId: string, recipientId: string): Promise<NotificationWithActor | undefined> {
    const result = await pool.query(
      `SELECT 
        n.notification_id,
        n.recipient_id,
        n.actor_id,
        n.notification_type,
        n.target_type,
        n.target_id,
        n.message,
        n.is_read,
        n.created_at,
        n.read_at,
        u.username as actor_username
       FROM notifications n
       LEFT JOIN users u ON n.actor_id = u.user_id
       WHERE n.notification_id = $1 AND n.recipient_id = $2`,
      [notificationId, recipientId]
    );

    const notification = result.rows[0];

    if (notification) {
      // Fetch user media for actor
      const userMediaMap = await mediaRepository.getUsersMedia([notification.actor_id]);
      (notification as any).actor_user_media = userMediaMap[notification.actor_id] || [];
    }

    return toCamel(notification);
  }

  /**
   * Get FCM token for a user
   */
  async getUserFcmToken(userId: string): Promise<string | null | undefined> {
    const result = await pool.query(
      `SELECT fcm_token FROM users WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0]?.fcm_token;
  }

  /**
   * Update FCM token for a user
   */
  async updateFcmToken(userId: string, token: string): Promise<{ userId: string } | undefined> {
    const result = await pool.query(
      `UPDATE users SET fcm_token = $1 WHERE user_id = $2 RETURNING user_id`,
      [token, userId]
    );

    return toCamel(result.rows[0]);
  }


  /**
   * Find recent aggregated notification for same target
   */
  async findRecentAggregatedNotification(
    recipientId: string,
    targetType: string,
    targetId: string,
    notificationType: string,
    withinMinutes: number = 5
  ): Promise<any | null> {
    const result = await pool.query(
      `SELECT * FROM notifications
       WHERE recipient_id = $1
         AND target_type = $2
         AND target_id = $3
         AND notification_type = $4
         AND created_at > NOW() - INTERVAL '${withinMinutes} minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [recipientId, targetType, targetId, notificationType]
    );

    return toCamel(result.rows[0]) || null;
  }

  /**
   * Update aggregated notification message
   */
  async updateAggregatedNotification(
    notificationId: string,
    message: string
  ): Promise<void> {
    await pool.query(
      `UPDATE notifications
       SET message = $1,
           is_read = FALSE,
           created_at = NOW()
       WHERE notification_id = $2`,
      [message, notificationId]
    );
  }

  /**
   * Get usernames for actors
   */
  async getUsernames(userIds: string[]): Promise<string[]> {
    if (!userIds || userIds.length === 0) return [];

    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT username FROM users WHERE user_id IN (${placeholders}) ORDER BY user_id`,
      userIds
    );

    return result.rows.map(r => r.username);
  }
}

export default new NotificationsRepository();