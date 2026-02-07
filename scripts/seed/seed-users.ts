/**
 * Utility script for creating a bulk set of randomized user accounts.
 *
 * Features:
 * - Generates unique names, emails, and passwords.
 * - Writes generated user records to `users_data.json`.
 * - Captures execution performance metrics in `performance_records.txt`.
 *
 * Usage Note:
 * For testing scenarios, consider adjusting the refresh-token lifespan in the configuration
 * before running this script. This prevents newly generated tokens stored in `users_data.json`
 * from expiring during test execution.
 */

import fs from 'fs';
import path from 'path';
import { getNames } from './extract-names.js';
import AuthService from '../../src/services/AuthService.js';
import { pool } from '../../src/config/pg.config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_JSON_PATH = path.join(__dirname, '../data/auth/users_data.json');
// Make sure directory exists
if (!fs.existsSync(path.dirname(OUTPUT_JSON_PATH))) {
    fs.mkdirSync(path.dirname(OUTPUT_JSON_PATH), { recursive: true });
}
const PERFORMANCE_TXT_PATH = path.join(__dirname, `../performance/performance_${Date.now()}.txt`);
if (!fs.existsSync(path.dirname(PERFORMANCE_TXT_PATH))) {
    fs.mkdirSync(path.dirname(PERFORMANCE_TXT_PATH), { recursive: true });
}

async function seedUsers() {
    try {
        const names = getNames();
        const totalUsersToCreate = 1000;
        const usersData: any[] = [];
        let totalTimeMs = 0;

        console.log(`Starting seeding of ${totalUsersToCreate} users...`);
        const startTimeGlobal = performance.now();

        for (let i = 0; i < totalUsersToCreate; i++) {
            const rawName = names[i % names.length]; // Cycle through names if needed

            // 1. Process Name for Username: Remove all non-alphanumeric except underscore, replace spaces with underscore
            // Regex: keep only a-z, 0-9, _
            let cleanName = rawName.trim().replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');

            // 2. Generate Uniqueness Suffix (Random Number)
            // Ensure username is max 30 chars.
            // Suffix format: _1234 (5 chars)
            const randomSuffix = Math.floor(1000 + Math.random() * 9000); // 4 digit random

            // Truncate cleanName if needed: 30 - 5 (suffix) = 25 chars max for name
            if (cleanName.length > 24) {
                cleanName = cleanName.substring(0, 24);
            }

            // Valid Username: letters, numbers, underscores, 3-30 chars
            const username = `${cleanName}_${randomSuffix}`;

            // 3. Generate Email: Valid gmail with numbers
            // Use dot separation for email to make it look standard, but ensure uniqueness with suffix
            const emailBase = cleanName.replace(/_/g, '.');
            const email = `${emailBase}${randomSuffix}@gmail.com`;

            const password = 'Password@123'; // Meets complexity requirements

            const start = performance.now();

            try {
                // Register user
                const authResponse = await AuthService.register(
                    email,
                    username,
                    password,
                    '127.0.0.1',
                    'SeedScript'
                );

                const end = performance.now();
                const duration = end - start;
                totalTimeMs += duration;

                usersData.push({
                    userId: authResponse.user.userId,
                    name: rawName,
                    username: authResponse.user.username,
                    email: authResponse.user.email,
                    password: password,
                    accessToken: authResponse.accessToken,
                    refreshToken: authResponse.refreshToken,
                    accountStatus: authResponse.user.accountStatus,
                    creationTimeMs: duration.toFixed(2),
                    createdAt: new Date().toISOString()
                });

                if ((i + 1) % 50 === 0) {
                    console.log(`Created ${i + 1} users...`);
                }

            } catch (err: any) {
                // Handle duplicate conflicts
                if (err.message && (err.message.includes('Username taken') || err.message.includes('Email taken'))) {
                    console.warn(`Duplicate collision for ${username} / ${email}. Skipping.`);
                } else {
                    console.error(`Failed to register user ${email}:`, err);
                }
            }
        }

        const endTimeGlobal = performance.now();
        const globalDuration = (endTimeGlobal - startTimeGlobal) / 1000; // seconds

        // Calc metrics
        const successCount = usersData.length;
        const avgTimePerUser = successCount > 0 ? (totalTimeMs / successCount) : 0;

        const performanceReport = `
Performance Report - User Seeding
---------------------------------
Date: ${new Date().toISOString()}
Total Users Requested: ${totalUsersToCreate}
Total Users Created: ${successCount}
Total Execution Time: ${globalDuration.toFixed(2)} seconds
Average API Latency Per User: ${avgTimePerUser.toFixed(2)} ms
Total "AuthService.register" Time: ${(totalTimeMs / 1000).toFixed(2)} seconds
---------------------------------
        `;

        console.log(performanceReport);

        // Write to files
        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(usersData, null, 2));
        fs.writeFileSync(PERFORMANCE_TXT_PATH, performanceReport);

        console.log(`Data saved to: ${OUTPUT_JSON_PATH}`);
        console.log(`Performance report saved to: ${PERFORMANCE_TXT_PATH}`);

        // Ensure accounts are active and tokens are verified after batch creation
        const { activateAndRefreshUsers } = await import('../setup/activate-and-refresh-users.js');
        await activateAndRefreshUsers(false);

    } catch (error) {
        console.error('Seeding failed:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

seedUsers();
