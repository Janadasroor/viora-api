import { sError, sDebug } from "sk-logger";
import messengerRepository from "../repositories/CassandraMessengerRepository.js";
import userRepository from "../repositories/UserRepository.js";
import mediaRepository from "../repositories/MediaRepository.js";
import type {
    Message,
    Conversation,
    PaginatedMessages,
    MessengerUser
} from "@types";

class MessengerService {
    /**
     * Hydrate a list of user IDs into rich MessengerUser objects with profile media
     */
    private async hydrateUsers(userIds: string[]): Promise<Record<string, MessengerUser>> {
        if (userIds.length === 0) return {};

        try {
            const uniqueIds = [...new Set(userIds)];
            const users = await userRepository.getUsersByIds(uniqueIds);
            const userMediaMap = await mediaRepository.getUsersMedia(uniqueIds);

            const usersMap: Record<string, MessengerUser> = {};
            users.forEach((user: any) => {
                usersMap[user.userId] = {
                    userId: user.userId,
                    username: user.username,
                    displayName: user.displayName,
                    isVerified: user.isVerified,
                    bio: user.bio,
                    followersCount: user.followersCount?.toString(),
                    followingCount: user.followingCount?.toString(),
                    userMedia: userMediaMap[user.userId] || []
                };
            });

            return usersMap;
        } catch (error) {
            sError("Error hydrating messenger users:", error);
            return {};
        }
    }

    async getConversations(userId: string): Promise<Conversation[]> {
        try {
            const conversations = await messengerRepository.getConversationsForUser(userId);

            const allMemberIds = [...new Set(conversations.flatMap(c => c.members))];
            const usersMap = await this.hydrateUsers(allMemberIds);

            return conversations.map(conv => ({
                ...conv,
                members: conv.members.map((id: string) => usersMap[id]).filter((u: MessengerUser | undefined): u is MessengerUser => !!u),
            }));
        } catch (error) {
            sError("Error in getConversations service:", error);
            throw error;
        }
    }

    async getMessages(conversationId: string, userId: string, limit: number, cursor?: string): Promise<PaginatedMessages> {
        try {
            const conversation = await messengerRepository.getConversationById(conversationId);

            if (!conversation || !conversation.members.includes(userId)) {
                throw new Error("Conversation not found or access denied");
            }

            const messages = await messengerRepository.getMessagesForConversation(conversationId, limit, cursor);

            const senderIds = [...new Set(messages.map(m => m.senderId))];
            const usersMap = await this.hydrateUsers(senderIds);

            const enrichedMessages = messages.map(m => {
                let parsedMetadata = {};
                try {
                    parsedMetadata = m.metadata ? JSON.parse(m.metadata) : {};
                } catch (e) {
                    // metadata is not a JSON string
                }

                return {
                    ...m,
                    metadata: parsedMetadata,
                    sender: usersMap[m.senderId] || { userId: m.senderId }
                } as Message;
            });

            return {
                messages: enrichedMessages,
                pagination: {
                    limit,
                    count: messages.length,
                    nextCursor: (messages.length === limit && messages.length > 0) ? messages[messages.length - 1]?.messageId : null
                }
            };
        } catch (error) {
            sError("Error in getMessages service:", error);
            throw error;
        }
    }

    async getConversationById(id: string, userId: string): Promise<Conversation> {
        try {
            const conversation = await messengerRepository.getConversationById(id);

            if (!conversation || !conversation.members.includes(userId)) {
                throw new Error("Conversation not found");
            }

            const usersMap = await this.hydrateUsers(conversation.members);

            return {
                ...conversation,
                members: conversation.members.map(id => usersMap[id]).filter((u: MessengerUser | undefined): u is MessengerUser => !!u)
            };
        } catch (error) {
            sError("Error in getConversationById service:", error);
            throw error;
        }
    }

    async startPrivateChat(fromUsername: string, toUsername: string): Promise<string> {
        try {
            const users = await userRepository.getUsersByUsernames([fromUsername, toUsername]);

            if (users.length < 2) {
                throw new Error("One or both users not found");
            }

            const fromUserId = users.find((u: any) => u.username === fromUsername)?.userId;
            const toUserId = users.find((u: any) => u.username === toUsername)?.userId;

            if (!fromUserId || !toUserId) {
                throw new Error("User IDs not found");
            }

            const conversationId = await messengerRepository.getOrCreatePrivateConversation(fromUserId, toUserId);
            if (!conversationId) throw new Error("Failed to start private chat");

            return conversationId;
        } catch (error) {
            sError("Error in startPrivateChat service:", error);
            throw error;
        }
    }

    async createConversation(userId: string, members: string[], name?: string, isGroup?: boolean): Promise<Conversation> {
        try {
            const conversation = await messengerRepository.createConversation({
                members: isGroup ? [...members, userId] : [userId, ...members],
                name: name || '',
                isGroup: isGroup || false,
                groupAdmin: isGroup ? userId : null
            });

            if (!conversation) throw new Error("Failed to create conversation");

            const usersMap = await this.hydrateUsers(conversation.members as string[]);

            return {
                ...conversation,
                members: (conversation.members as string[]).map(id => usersMap[id]).filter((u: MessengerUser | undefined): u is MessengerUser => !!u)
            };
        } catch (error) {
            sError("Error in createConversation service:", error);
            throw error;
        }
    }

    async updateConversation(conversationId: string, userId: string, data: { name?: string; members?: string[] }): Promise<void> {
        const conversation = await messengerRepository.getConversationById(conversationId);
        if (!conversation || !conversation.members.includes(userId)) {
            throw new Error("Conversation not found");
        }
        if (conversation.isGroup && conversation.groupAdmin !== userId) {
            throw new Error("Only admin can update group");
        }
        await messengerRepository.updateConversation(conversationId, data);
    }

    async deleteConversation(conversationId: string, userId: string): Promise<void> {
        const conversation = await messengerRepository.getConversationById(conversationId);
        if (!conversation || !conversation.members.includes(userId)) {
            throw new Error("Conversation not found");
        }
        if (conversation.isGroup && conversation.groupAdmin !== userId) {
            throw new Error("Only admin can delete group");
        }
        await messengerRepository.deleteConversation(conversationId);
    }

    async markMessageAsRead(conversationId: string, messageId: string, userId: string): Promise<void> {
        await messengerRepository.markMessageAsRead(conversationId, messageId, userId);
    }

    async markAllMessagesAsRead(conversationId: string, userId: string): Promise<void> {
        await messengerRepository.markAllMessagesAsRead(conversationId, userId);
    }

    async deleteMessage(conversationId: string, messageId: string, userId: string, deleteForEveryone: boolean): Promise<void> {
        if (deleteForEveryone) {
            // Usually we might check if sender is the one deleting, 
            // but repository will handle the logic if we pass it.
            // For now following existing logic in controller.
            await messengerRepository.deleteMessage(conversationId, messageId);
        } else {
            await messengerRepository.markMessageAsDeletedForUser(conversationId, messageId, userId);
        }
    }

    async reactToMessage(conversationId: string, messageId: string, userId: string, reaction: string): Promise<void> {
        await messengerRepository.reactToMessage(conversationId, messageId, userId, reaction);
    }
}

export default new MessengerService();
