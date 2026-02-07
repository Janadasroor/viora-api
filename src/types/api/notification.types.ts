import type { MediaFile } from "./post.types.js";

export interface NotificationData {
  recipientId: string;
  actorId: string;
  notificationType: string;
  targetType: string;
  targetId: string;
  message?: string | null;
}

export interface Notification {
  notificationId: string;
  recipientId: string;
  actorId: string;
  notificationType: string;
  targetType: string | null;
  targetId: string | null;
  message: string;
  isRead: boolean | null;
  createdAt: Date | null;
  readAt: Date | null;
}

export interface NotificationWithActor extends Notification {
  actorUsername: string | null;
  actorProfilePicture?: string | null;
  actorUserMedia?: MediaFile[];
}

export interface UnreadCount {
  count: string;
}
