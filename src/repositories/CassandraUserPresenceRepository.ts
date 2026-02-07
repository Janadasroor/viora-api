import cassandraClient from '../config/cassandra.config.js';
import { sError } from 'sk-logger';

export interface IUserPresence {
    userId: string;
    name?: string;
    email?: string;
    avatar?: string;
    is_online: boolean;
    last_seen: Date;
    updated_at: Date;
}

class CassandraUserPresenceRepository {

    async updatePresence(userId: string, isOnline: boolean, userInfo?: Partial<IUserPresence>): Promise<void> {
        try {
            const now = new Date();
            const query = `
                INSERT INTO user_presence (userId, is_online, last_seen, updated_at, name, email, avatar) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;

            await cassandraClient.execute(query, [
                userId,
                isOnline,
                now,
                now,
                userInfo?.name || null,
                userInfo?.email || null,
                userInfo?.avatar || null
            ], { prepare: true });

        } catch (error) {
            sError('Error updating user presence in Cassandra:', error);
        }
    }

    async getPresence(userId: string): Promise<IUserPresence | null> {
        try {
            const query = 'SELECT * FROM user_presence WHERE userId = ?';
            const result = await cassandraClient.execute(query, [userId], { prepare: true });
            if (result.rowLength === 0) return null;

            const row = result.first();
            return {
                userId: row.userid.toString(),
                name: row.name,
                email: row.email,
                avatar: row.avatar,
                is_online: row.is_online,
                last_seen: row.last_seen,
                updated_at: row.updated_at
            };
        } catch (error) {
            sError('Error getting user presence from Cassandra:', error);
            return null;
        }
    }
}

export default new CassandraUserPresenceRepository();
