import { pool } from '../src/config/pg.config.js';
import { sInfo, sError } from 'sk-logger';
import 'dotenv/config';

async function setupSearchIndexes() {
    try {
        sInfo('Starting search index setup...');

        // 1. Install pg_trgm extension
        sInfo('Installing pg_trgm extension...');
        await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

        // 2. Add GIN index for Posts FTS
        sInfo('Adding GIN index for Posts caption FTS...');
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_caption_fts ON posts 
      USING GIN (to_tsvector('english', COALESCE(caption, '')));
    `);

        // 3. Add GIN indexes for Users Trigram search
        sInfo('Adding Trigram indexes for Users username and display_name...');
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users 
      USING GIN (username gin_trgm_ops);
    `);
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name_trgm ON user_profiles 
      USING GIN (display_name gin_trgm_ops);
    `);

        sInfo('Search index setup completed successfully.');
        process.exit(0);
    } catch (err) {
        sError('Error setting up search indexes:', err);
        process.exit(1);
    }
}

setupSearchIndexes();
