import { pool } from "../config/pg.config.js";
import { admin, isFirebaseEnabled } from "../config/firebase.config.js";
import { getIO } from "../utils/socketManager.js";
import type { PoolClient } from "pg";
import { sDebug, sError } from "sk-logger";

interface CreateNotificationOptions {
  recipientId: string;
  actorId: string;
  type: string;
  targetType: string;
  targetId: string; // UUID
  message: string;
  sendPush?: boolean;
  sendSocket?: boolean;
  wasAlreadyLiked?: boolean;
}

interface NotificationResult {
  success: boolean;
  id?: number;
  error?: string;
}

interface UserData {
  recipient_token: string | null;
  recipient_username: string;
  actor_username: string;
}

/**
 * Create a notification and optionally send push + websocket events.
 *
 * @param options - Notification creation options
 * @param options.recipientId - The user who receives the notification
 * @param options.actorId - The user who triggered the notification
 * @param options.type - Notification type ('comment', 'like', 'follow', 'mention', etc.)
 * @param options.targetType - The entity being acted on ('post', 'comment', 'user', etc.)
 * @param options.targetId - The target entity UUID
 * @param options.message - Notification text
 * @param options.sendPush - Whether to send FCM push (default: true)
 * @param options.sendSocket - Whether to emit via WebSocket (default: true)
 * @param options.wasAlreadyLiked - Whether the item was already liked (default: false)
 */
export async function createNotification({
  recipientId,
  actorId,
  type,
  targetType,
  targetId,
  message,
  sendPush = true,
  sendSocket = true,
  wasAlreadyLiked = false,
}: CreateNotificationOptions): Promise<NotificationResult> {
  sDebug("createNotification called with:", {
    recipientId,
    actorId,
    type,
    targetType,
    targetId,
    message,
    sendPush,
    sendSocket,
  });
  sDebug("wasAlreadyLiked:", wasAlreadyLiked);

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    // Prevent self-notification
    if (recipientId === actorId) {
      return { success: false, error: "Cannot notify self" };
    }

    // Fetch recipient and actor data in a single query
    const userQuery = `
      SELECT 
        u1.fcm_token AS recipient_token, 
        u1.username AS recipient_username, 
        u2.username AS actor_username
      FROM users u1
      CROSS JOIN users u2
      WHERE u1.user_id = $1 AND u2.user_id = $2
    `;

    const userResult = await client.query<UserData>(userQuery, [
      recipientId,
      actorId,
    ]);

    if (userResult.rows.length === 0 || userResult.rows[0] === undefined) {
      return { success: false, error: "User not found" };
    }

    const { recipient_token, recipient_username, actor_username } =
      userResult.rows[0];

    // Insert into notifications table
    const insertQuery = `
      INSERT INTO notifications (
        recipient_id, 
        actor_id, 
        notification_type, 
        target_type, 
        target_id, 
        message
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const insertResult = await client.query<{ id: number }>(insertQuery, [
      recipientId,
      actorId,
      type,
      targetType,
      targetId,
      `${actor_username} ${message}`,
    ]);
    if (insertResult.rows.length === 0 || insertResult.rows[0] === undefined) {
      return { success: false, error: "Failed to insert notification" };
    }
    const notificationId = insertResult.rows[0].id;

    // Send push notification (optional)
    if (sendPush && recipient_token) {
      await sendPushNotification(
        recipient_token,
        "New Notification",
        `${actor_username} ${message}`
      );
    }

    // Send real-time WebSocket event (optional)
    if (sendSocket) {
      const io = getIO();
      io.to(`user_${recipientId}`).emit("notification", {
        id: notificationId,
        type,
        message: `${actor_username} ${message}`,
        username: actor_username,
        actorId,
        targetType,
        targetId,
        created_at: new Date(),
      });
    }

    await client.query("COMMIT");
    return { success: true, id: notificationId };
  } catch (err) {
    if (client) {
      await client.query("ROLLBACK");
    }
    sError("Error in createNotification:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: errorMessage };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Send FCM push notification
 *
 * @param token - FCM device token
 * @param title - Notification title
 * @param message - Notification body
 */
export async function sendPushNotification(
  token: string,
  title: string,
  message: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    if (!isFirebaseEnabled || admin.apps.length === 0) {
      sDebug(
        "Push notification skipped: Firebase is disabled or not initialized"
      );
      return;
    }

    sDebug("Sending push to token:", { token, title, message, data });
    const payload: any = {
      token,
      notification: { title, body: message },
    };
    if (data) {
      payload.data = data;
    }
    await admin.messaging().send(payload);
    sDebug("Push notification sent");
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    sError("FCM Notification Error:", errorMessage);
  }
}