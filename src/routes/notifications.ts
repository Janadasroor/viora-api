import { Router } from "express";
import notificationsController from "../controllers/NotificationsController.js";
import { validate } from "../middleware/validation.js";
import * as notificationSchemas from "../validators/schemas/notifications.schemas.js";

const router = Router();

// Update FCM token for a user
router.post("/fcm-token", validate(notificationSchemas.updateFcmTokenSchema), notificationsController.updateFcmToken);

// Send test notification
router.post("/test-notification", validate(notificationSchemas.sendTestNotificationSchema), notificationsController.sendTestNotification);

// Create a new notification
router.post("/", validate(notificationSchemas.createNotificationSchema), notificationsController.createNotification);

// Get notifications for the authenticated user
router.get("/", validate(notificationSchemas.getNotificationsSchema), notificationsController.getUserNotifications);

// Get unread notification count
router.get("/unread-count", notificationsController.getUnreadCount);

// Mark a notification as read
router.put("/read/:id", validate(notificationSchemas.notificationIdSchema), notificationsController.markAsRead);

// Mark all notifications as read
router.put("/read-all", notificationsController.markAllAsRead);

// Delete a notification
router.delete("/:id", validate(notificationSchemas.notificationIdSchema), notificationsController.deleteNotification);

// Delete all notifications
router.delete("/", notificationsController.deleteAllNotifications);

export default router;