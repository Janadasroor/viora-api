import { pool } from "../config/pg.config.js";

export async function createTables(query: string) {
    try {
        await pool.query(query);
    } catch (error) {
        console.error('Error creating tables:', error);
    } finally {
        await pool.end();
    }
}

createTables(`
CREATE TABLE IF NOT EXISTS post_shares (
    share_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
    post_id UUID REFERENCES posts(post_id) ON DELETE CASCADE,
    shared_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id)
);
`);