import type { Request, Response } from "express";
import notificationsService from "../services/NotificationsService.js";
import { sDebug, sError } from "sk-logger";
import type { AuthenticatedRequest } from "@types";

class NotificationsController {

  // Update FCM token for a user
  async updateFcmToken(req: Request, res: Response) {
    try {
      const { token } = req.body;
      const userId = (req as AuthenticatedRequest).user?.userId;

      if (!userId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      sDebug(`Received FCM token from user ${userId}`);

      await notificationsService.updateFcmToken(userId, token);

      res.json({ success: true });
    } catch (error) {
      sError("Error updating FCM token:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Send test notification
  async sendTestNotification(req: Request, res: Response) {
    try {
      const { token, title, message } = req.body;

      await notificationsService.sendTestNotification(token, title, message);

      res.json({ success: true });
    } catch (error) {
      sError("Error sending test notification:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Create a new notification
  async createNotification(req: Request, res: Response) {
    try {
      const {
        recipientId,
        actorId,
        notificationType,
        targetType,
        targetId,
        message,
        sendPush = true
      } = req.body;

      const notification = await notificationsService.notify({
        recipientId,
        actorId,
        notificationType,
        targetType,
        targetId,
        message,
        sendPush
      });

      res.status(201).json({
        success: true,
        data: notification
      });
    } catch (error) {
      sError("Error creating notification:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Get notifications for the authenticated user
  async getUserNotifications(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req.query as any).userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      const { page = 1, limit = 20 } = req.query;

      const result = await notificationsService.getUserNotifications(
        String(userId),
        Number(page),
        Number(limit)
      );

      res.json({
        success: true,
        data: result.notifications,
        page: result.page,
        limit: result.limit
      });
    } catch (error) {
      sError("Error fetching notifications:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Get unread notification count
  async getUnreadCount(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId || (req.query as any).userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      const result = await notificationsService.getUnreadCount(String(userId));

      res.json({
        success: true,
        count: result.count
      });
    } catch (error) {
      sError("Error getting unread count:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Mark a notification as read
  async markAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const notificationId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          error: "Notification ID is required"
        });
      }

      await notificationsService.markAsRead(notificationId, userId);

      res.json({ success: true });
    } catch (error) {
      sError("Error marking notification as read:", error);

      if ((error as any).message.includes("not found")) {
        return res.status(404).json({
          success: false,
          error: (error as any).message
        });
      }

      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      const result = await notificationsService.markAllAsRead(userId);

      res.json({
        success: true,
        count: result.count
      });
    } catch (error) {
      sError("Error marking all notifications as read:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Delete a notification
  async deleteNotification(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;
      const notificationId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      if (!notificationId) {
        return res.status(400).json({
          success: false,
          error: "Notification ID is required"
        });
      }

      await notificationsService.deleteNotification(notificationId, userId);

      res.json({ success: true });
    } catch (error) {
      sError("Error deleting notification:", error);

      if ((error as any).message.includes("not found")) {
        return res.status(404).json({
          success: false,
          error: (error as any).message
        });
      }

      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }

  // Delete all notifications
  async deleteAllNotifications(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "User not authenticated"
        });
      }

      const result = await notificationsService.deleteAllNotifications(userId);

      res.json({
        success: true,
        count: result.count
      });
    } catch (error) {
      sError("Error deleting all notifications:", error);
      res.status(500).json({
        success: false,
        error: (error as any).message
      });
    }
  }
}

export default new NotificationsController();