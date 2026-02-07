import cassandraClient from '../config/cassandra.config.js';
import { sDebug, sError } from 'sk-logger';
import cassandra from 'cassandra-driver';

const { types } = cassandra;

export interface ICassandraMessage {
    conversationId: string; // uuid
    messageId: string;      // timeuuid
    senderId: string;
    messageType: string;
    content?: string;
    mediaUrl?: string;
    metadata?: string;       // JSON string
    isDelivered: boolean;
    deliveredBy: { [key: string]: Date };
    isRead: boolean;
    readBy: { userId: string; readAt: Date | string }[];
    isDeleted: boolean;
    deletedAt?: Date;
    deletedFor: string[];
    reactions: { userId: string; reaction: string; reactedAt: string }[];
    createdAt: Date;
}

export interface ICassandraConversation {
    conversationId: string;
    members: string[];
    name?: string;
    isGroup: boolean;
    groupAdmin?: string | null | undefined;
    lastMessageId?: string;
    lastMessageTime?: Date;
    lastMessageContent?: string;
    createdAt: Date;
    updatedAt: Date;
}

class CassandraMessengerRepository {

    async getConversationById(conversationId: string): Promise<ICassandraConversation | null> {
        try {
            const query = 'SELECT * FROM conversations WHERE conversation_id = ?';
            const result = await cassandraClient.execute(query, [types.Uuid.fromString(conversationId)], { prepare: true });
            if (result.rowLength === 0) return null;

            const row = result.first();
            return {
                conversationId: row.conversation_id.toString(),
                members: Array.from(row.members || []).map((id: any) => id.toString()),
                name: row.name,
                isGroup: row.is_group,
                groupAdmin: row.group_admin ? row.group_admin.toString() : null,
                lastMessageId: row.last_message_id?.toString(),
                lastMessageTime: row.last_message_time,
                lastMessageContent: row.last_message_content,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            };
        } catch (error) {
            sError('Error getting conversation from Cassandra:', error);
            return null;
        }
    }

    async getMessageById(conversationId: string, messageId: string): Promise<ICassandraMessage | null> {
        try {
            const query = 'SELECT * FROM messages_by_conversation WHERE conversation_id = ? AND message_id = ?';
            const result = await cassandraClient.execute(query, [
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });

            if (result.rowLength === 0) return null;

            const row = result.first();
            return this.mapRowToMessage(row);
        } catch (error) {
            sError('Error getting message from Cassandra:', error);
            return null;
        }
    }

    async createMessage(message: Partial<ICassandraMessage>): Promise<ICassandraMessage | null> {
        try {
            const messageId = types.TimeUuid.now();
            const createdAt = new Date();
            const query = `
                INSERT INTO messages_by_conversation 
                (conversation_id, message_id, sender_id, message_type, content, media_url, 
                 metadata, is_delivered, delivered_by, is_read, read_by, is_deleted, deleted_for, reactions, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const params = [
                types.Uuid.fromString(message.conversationId!),
                messageId,
                message.senderId,
                message.messageType,
                message.content || '',
                message.mediaUrl || '',
                message.metadata || '{}',
                false,
                {},
                false,
                {},
                false,
                [],
                {},
                createdAt
            ];

            await cassandraClient.execute(query, params, { prepare: true });

            return {
                ...message as ICassandraMessage,
                messageId: messageId.toString(),
                isDelivered: false,
                deliveredBy: {},
                isRead: false,
                readBy: [],
                isDeleted: false,
                deletedFor: [],
                reactions: [],
                createdAt: createdAt
            };
        } catch (error) {
            sError('Error creating message in Cassandra:', error);
            return null;
        }
    }

    async updateConversationLastMessage(conversationId: string, messageId: string, messageTime: Date, content?: string): Promise<void> {
        try {
            const query = `
                UPDATE conversations 
                SET last_message_id = ?, last_message_time = ?, last_message_content = ?, updated_at = ? 
                WHERE conversation_id = ?
            `;
            await cassandraClient.execute(query, [
                types.TimeUuid.fromString(messageId),
                messageTime,
                content || '',
                new Date(),
                types.Uuid.fromString(conversationId)
            ], { prepare: true });
        } catch (error) {
            sError('Error updating conversation last message:', error);
        }
    }

    async markMessageAsDelivered(conversationId: string, messageId: string, userId: string): Promise<void> {
        try {
            const query = `
                UPDATE messages_by_conversation
                SET is_delivered = true, delivered_by[?] = ?
                WHERE conversation_id = ? AND message_id = ?
            `;
            await cassandraClient.execute(query, [
                userId,
                new Date(),
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });
        } catch (error) {
            sError('Error marking message as delivered:', error);
        }
    }

    async markMessagesAsDelivered(conversationId: string, messageIds: string[], userId: string): Promise<void> {
        try {
            const promises = messageIds.map(messageId => {
                const query = `
                    UPDATE messages_by_conversation
                    SET is_delivered = true, delivered_by[?] = ?
                    WHERE conversation_id = ? AND message_id = ?
                `;
                return cassandraClient.execute(query, [
                    userId,
                    new Date(),
                    types.Uuid.fromString(conversationId),
                    types.TimeUuid.fromString(messageId)
                ], { prepare: true });
            });
            await Promise.all(promises);
        } catch (error) {
            sError('Error marking messages as delivered:', error);
        }
    }

    async markMessageAsRead(conversationId: string, messageId: string, userId: string): Promise<void> {
        try {
            const query = `
                UPDATE messages_by_conversation 
                SET is_read = true, read_by[?] = ? 
                WHERE conversation_id = ? AND message_id = ?
            `;
            await cassandraClient.execute(query, [
                userId,
                new Date(),
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });
        } catch (error) {
            sError('Error marking message as read in Cassandra:', error);
        }
    }

    async markMessagesAsRead(conversationId: string, messageIds: string[], userId: string): Promise<void> {
        try {
            const queries = messageIds.map(id => ({
                query: `UPDATE messages_by_conversation SET is_read = true, read_by[?] = ? WHERE conversation_id = ? AND message_id = ?`,
                params: [userId, new Date(), types.Uuid.fromString(conversationId), types.TimeUuid.fromString(id)]
            }));
            await cassandraClient.batch(queries, { prepare: true });
        } catch (error) {
            sError('Error marking messages as read in Cassandra:', error);
        }
    }

    async getConversationsForUser(userId: string): Promise<any[]> {
        try {
            const query = 'SELECT conversation_id, last_message_time FROM conversations_by_user WHERE user_id = ?';
            const result = await cassandraClient.execute(query, [userId], { prepare: true });

            const conversationPromises = result.rows.map(row =>
                this.getConversationById(row.conversation_id.toString())
            );

            const conversations = await Promise.all(conversationPromises);
            return conversations.filter(c => c !== null);
        } catch (error) {
            sError('Error getting user conversations from Cassandra:', error);
            return [];
        }
    }

    async getMessages(conversationId: string, limit: number = 50, cursor?: string): Promise<ICassandraMessage[]> {
        return this.getMessagesForConversation(conversationId, limit, cursor);
    }

    async getMessagesForConversation(conversationId: string, limit: number = 50, cursor?: string): Promise<ICassandraMessage[]> {
        try {
            let query = 'SELECT * FROM messages_by_conversation WHERE conversation_id = ?';
            const params: any[] = [types.Uuid.fromString(conversationId)];

            if (cursor) {
                query += ' AND message_id < ?';
                params.push(types.TimeUuid.fromString(cursor));
            }

            query += ' LIMIT ?';
            params.push(limit);

            const result = await cassandraClient.execute(query, params, { prepare: true });
            return result.rows.map(row => this.mapRowToMessage(row));
        } catch (error) {
            sError('Error getting messages from Cassandra:', error);
            return [];
        }
    }

    async createConversation(data: Partial<ICassandraConversation>): Promise<ICassandraConversation | null> {
        try {
            const conversationId = types.Uuid.random();
            const now = new Date();
            const query = `
                INSERT INTO conversations 
                (conversation_id, members, name, is_group, group_admin, created_at, updated_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            const members = (data.members || []);
            const groupAdmin = data.groupAdmin || null;

            const params = [
                conversationId,
                members,
                data.name || '',
                data.isGroup || false,
                groupAdmin,
                now,
                now
            ];

            await cassandraClient.execute(query, params, { prepare: true });

            // Also update conversations_by_user for each member
            if (members.length > 0) {
                const batchQueries = members.map(userId => ({
                    query: 'INSERT INTO conversations_by_user (user_id, conversation_id, last_message_time) VALUES (?, ?, ?)',
                    params: [userId, conversationId, now]
                }));
                await cassandraClient.batch(batchQueries, { prepare: true });
            }

            return {
                conversationId: conversationId.toString(),
                members,
                name: data.name || '',
                isGroup: data.isGroup || false,
                groupAdmin: groupAdmin,
                createdAt: now,
                updatedAt: now
            };
        } catch (error) {
            sError('Error creating conversation in Cassandra:', error);
            return null;
        }
    }

    async updateConversation(conversationId: string, data: { name?: string, members?: string[] }): Promise<void> {
        try {
            const existing = await this.getConversationById(conversationId);
            if (!existing) return;

            const queries: { query: string, params: any[] }[] = [];
            const now = new Date();

            if (data.name !== undefined) {
                queries.push({
                    query: 'UPDATE conversations SET name = ?, updated_at = ? WHERE conversation_id = ?',
                    params: [data.name, now, types.Uuid.fromString(conversationId)]
                });
            }

            if (data.members !== undefined) {
                const normalizedMembers = data.members;
                queries.push({
                    query: 'UPDATE conversations SET members = ?, updated_at = ? WHERE conversation_id = ?',
                    params: [normalizedMembers, now, types.Uuid.fromString(conversationId)]
                });

                // Update conversations_by_user
                const oldMembers = existing.members;
                const newMembers = normalizedMembers;
                const toAdd = newMembers.filter(m => !oldMembers.includes(m));
                const toRemove = oldMembers.filter(m => !newMembers.includes(m));

                toAdd.forEach(userId => {
                    queries.push({
                        query: 'INSERT INTO conversations_by_user (user_id, conversation_id, last_message_time) VALUES (?, ?, ?)',
                        params: [userId, types.Uuid.fromString(conversationId), existing.lastMessageTime || now]
                    });
                });

                toRemove.forEach(userId => {
                    queries.push({
                        query: 'DELETE FROM conversations_by_user WHERE user_id = ? AND conversation_id = ?',
                        params: [userId, types.Uuid.fromString(conversationId)]
                    });
                });
            }

            if (queries.length > 0) {
                await cassandraClient.batch(queries, { prepare: true });
            }
        } catch (error) {
            sError('Error updating conversation in Cassandra:', error);
        }
    }

    async deleteConversation(conversationId: string): Promise<void> {
        try {
            const existing = await this.getConversationById(conversationId);
            if (!existing) return;

            const queries: { query: string, params: any[] }[] = [
                {
                    query: 'DELETE FROM conversations WHERE conversation_id = ?',
                    params: [types.Uuid.fromString(conversationId)]
                }
            ];

            existing.members.forEach(userId => {
                queries.push({
                    query: 'DELETE FROM conversations_by_user WHERE user_id = ? AND conversation_id = ?',
                    params: [userId, types.Uuid.fromString(conversationId)]
                });
            });

            // Note: We might also want to delete all messages, but in Cassandra 
            // it's often better to just leave them or delete the entire partition if possible.
            // For now, let's just delete the conversation metadata.

            await cassandraClient.batch(queries, { prepare: true });
        } catch (error) {
            sError('Error deleting conversation in Cassandra:', error);
        }
    }

    async getOrCreatePrivateConversation(userAId: string, userBId: string): Promise<string | null> {
        try {
            sDebug(`getOrCreatePrivateConversation: userAId=${userAId}, userBId=${userBId}`);
            // This is tricky in Cassandra without a proper join or secondary index on members.
            // Since we have conversations_by_user, we can fetch for userA and filter for userB as a member.

            const userAConversations = await this.getConversationsForUser(userAId);
            sDebug(`getOrCreatePrivateConversation: found ${userAConversations.length} conversations for user ${userAId}`);

            const existing = userAConversations.find(c => {
                const members = c.members.map((m: any) => m.toString());
                return !c.isGroup &&
                    members.includes(userAId) &&
                    members.includes(userBId) &&
                    members.length === 2;
            });

            if (existing) {
                sDebug(`getOrCreatePrivateConversation: found existing conversation ${existing.conversationId}`);
                return existing.conversationId;
            }

            sDebug(`getOrCreatePrivateConversation: creating new conversation for ${userAId} and ${userBId}`);
            const newConv = await this.createConversation({
                members: [userAId, userBId],
                isGroup: false
            });

            sDebug(`getOrCreatePrivateConversation: newConv result:`, newConv);
            return newConv ? newConv.conversationId : null;
        } catch (error) {
            sError('Error in getOrCreatePrivateConversation:', error);
            return null;
        }
    }

    async deleteMessage(conversationId: string, messageId: string): Promise<void> {
        try {
            const query = `
                UPDATE messages_by_conversation 
                SET is_deleted = true, deleted_at = ? 
                WHERE conversation_id = ? AND message_id = ?
            `;
            await cassandraClient.execute(query, [
                new Date(),
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });
        } catch (error) {
            sError('Error deleting message in Cassandra:', error);
        }
    }

    async markMessageAsDeletedForUser(conversationId: string, messageId: string, userId: string): Promise<void> {
        try {
            const query = `
                UPDATE messages_by_conversation 
                SET deleted_for = deleted_for + [?] 
                WHERE conversation_id = ? AND message_id = ?
            `;
            await cassandraClient.execute(query, [
                userId,
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });
        } catch (error) {
            sError('Error marking message as deleted for user in Cassandra:', error);
        }
    }

    async markAllMessagesAsRead(conversationId: string, userId: string): Promise<void> {
        try {
            // In Cassandra, we can't easily update all rows without knowing the clustering keys (message_id).
            // Usually, we'd fetch unread messages and update them, or use a "last read" approach in the conversation metadata.
            // Since our schema has read_by as a map on each message, we have to update each one.

            // To be efficient, we fetch the last 100 messages and mark them as read if they aren't already.
            const messages = await this.getMessagesForConversation(conversationId, 100);
            const unreadIds = messages
                .filter(m => !m.readBy?.some(r => r.userId === userId))
                .map(m => m.messageId);

            if (unreadIds.length > 0) {
                await this.markMessagesAsRead(conversationId, unreadIds, userId);
            }
        } catch (error) {
            sError('Error marking all messages as read in Cassandra:', error);
        }
    }

    async reactToMessage(conversationId: string, messageId: string, userId: string, reaction: string): Promise<void> {
        try {
            const query = `
                UPDATE messages_by_conversation 
                SET reactions[?] = ? 
                WHERE conversation_id = ? AND message_id = ?
            `;
            await cassandraClient.execute(query, [
                userId,
                reaction,
                types.Uuid.fromString(conversationId),
                types.TimeUuid.fromString(messageId)
            ], { prepare: true });
        } catch (error) {
            sError('Error reacting to message in Cassandra:', error);
        }
    }

    private mapRowToMessage(row: any): ICassandraMessage {
        const deliveredBy: { [key: string]: Date } = {};
        if (row.delivered_by) {
            Object.entries(row.delivered_by).forEach(([k, v]) => {
                deliveredBy[k.toString()] = v as Date;
            });
        }

        const readBy: { userId: string; readAt: string }[] = [];
        if (row.read_by) {
            Object.entries(row.read_by).forEach(([userId, readAt]) => {
                readBy.push({
                    userId,
                    readAt: (readAt as Date).toISOString()
                });
            });
        }

        const reactions: { userId: string; reaction: string; reactedAt: string }[] = [];
        if (row.reactions) {
            Object.entries(row.reactions).forEach(([userId, reaction]) => {
                reactions.push({
                    userId,
                    reaction: reaction as string,
                    reactedAt: new Date().toISOString()
                });
            });
        }

        return {
            conversationId: row.conversation_id.toString(),
            messageId: row.message_id.toString(),
            senderId: row.sender_id?.toString(),
            messageType: row.message_type,
            content: row.content,
            mediaUrl: row.media_url,
            metadata: row.metadata,
            isDelivered: row.is_delivered,
            deliveredBy,
            isRead: row.is_read,
            readBy,
            isDeleted: row.is_deleted,
            deletedAt: row.deleted_at,
            deletedFor: Array.from(row.deleted_for || []).map((id: any) => id.toString()),
            reactions,
            createdAt: row.created_at
        };
    }
}

export default new CassandraMessengerRepository();
