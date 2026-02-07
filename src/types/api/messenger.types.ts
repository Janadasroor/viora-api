import type { MediaFile } from "./post.types.js";

export interface MessengerUser {
    userId: string;
    username: string;
    displayName: string;
    isVerified: boolean;
    bio?: string;
    followersCount?: string;
    followingCount?: string;
    userMedia?: MediaFile[];
}

export interface Message {
    conversationId: string;
    messageId: string;
    senderId: string;
    messageType: string;
    content?: string;
    mediaUrl?: string;
    metadata?: any;
    isDelivered: boolean;
    deliveredBy: Record<string, Date>;
    isRead: boolean;
    readBy: { userId: string; readAt: string | Date }[];
    isDeleted: boolean;
    deletedAt?: Date;
    deletedFor: string[];
    reactions: { userId: string; reaction: string; reactedAt: string }[];
    createdAt: Date;
    sender?: MessengerUser;
}

export interface Conversation {
    conversationId: string;
    members: string[] | MessengerUser[];
    name?: string;
    isGroup: boolean;
    groupAdmin?: string | null | undefined;
    lastMessageId?: string;
    lastMessageTime?: Date;
    lastMessageContent?: string;
    createdAt: Date;
    updatedAt: Date;
    unreadCount?: number;
}

export interface PaginatedMessages {
    messages: Message[];
    pagination: {
        limit: number;
        count: number;
        nextCursor?: string | null | undefined;
    };
}

export interface PaginatedConversations {
    conversations: Conversation[];
    count: number;
}
