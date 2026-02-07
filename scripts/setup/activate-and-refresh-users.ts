import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../src/config/pg.config.js';
import AuthService from '../../src/services/AuthService.js';
import redisClient from '../../src/config/redis.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_PROFILE_DATA_PATH = path.join(__dirname, '../data/auth/users_profile_data.json');
const USERS_DATA_PATH = path.join(__dirname, '../data/auth/users_data.json');

export async function activateAndRefreshUsers(closeResources: boolean = true) {
    console.log("Starting account activation and token refresh process...");

    try {
        // 1. Update Database
        console.log("Updating database: Setting all users to active and email_verified...");
        await pool.query("UPDATE users SET account_status = 'active', email_verified = true");
        console.log("Database update successful.");

        // 2. Load User Data from Profile Data (has more fields)
        if (!fs.existsSync(USERS_PROFILE_DATA_PATH)) {
            console.error("Users profile data file not found at:", USERS_PROFILE_DATA_PATH);
            return;
        }

        const users = JSON.parse(fs.readFileSync(USERS_PROFILE_DATA_PATH, 'utf-8'));
        const TOTAL_USERS = users.length;
        console.log(`Loaded ${TOTAL_USERS} users from JSON.`);

        const updatedUsers = [];
        const BATCH_SIZE = 25; // Concurrency limit for login (BCrypt is CPU intensive)

        console.log(`Refreshing tokens for ${TOTAL_USERS} users (Batch size: ${BATCH_SIZE})...`);

        for (let i = 0; i < TOTAL_USERS; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user: any) => {
                try {
                    // We assume Password@123 based on seed-users.ts
                    const authRes = await AuthService.login(
                        user.email,
                        'Password@123',
                        '127.0.0.1',
                        'InitializationScript'
                    );

                    return {
                        ...user,
                        accessToken: authRes.accessToken,
                        refreshToken: authRes.refreshToken,
                        accountStatus: 'active'
                    };
                } catch (loginErr: any) {
                    console.error(`Failed to login user ${user.email}:`, loginErr.message);
                    return {
                        ...user,
                        accountStatus: 'error_refreshing'
                    };
                }
            });

            const results = await Promise.all(batchPromises);
            updatedUsers.push(...results);

            console.log(`Processed ${Math.min(i + BATCH_SIZE, TOTAL_USERS)}/${TOTAL_USERS} users...`);
        }

        // 3. Save Updated Data to both files
        fs.writeFileSync(USERS_PROFILE_DATA_PATH, JSON.stringify(updatedUsers, null, 2));
        console.log(`✓ Updated tokens saved to: ${USERS_PROFILE_DATA_PATH}`);

        // Also update users_data.json to keep them in sync
        fs.writeFileSync(USERS_DATA_PATH, JSON.stringify(updatedUsers, null, 2));
        console.log(`✓ Copied to: ${USERS_DATA_PATH}`);
        console.log(`\n✅ Both user data files are now synchronized with fresh tokens!`);

    } catch (error) {
        console.error("Process failed:", error);
    } finally {
        if (closeResources) {
            await pool.end();
            if (redisClient.isOpen) {
                await redisClient.quit();
            }
            process.exit(0);
        }
    }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
    activateAndRefreshUsers().catch(console.error);
}

export default activateAndRefreshUsers;
