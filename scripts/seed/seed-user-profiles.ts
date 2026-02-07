import "dotenv/config";
import { pool } from "../../src/config/pg.config";
import fs from "fs";
import path from "path";
import { baseUrl } from "../utils/get-base-url";
import { performance } from "perf_hooks";
import { fileURLToPath } from 'url';
import { detectGender, updateUsersWithGender } from "../utils/detect-gender";
import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
// Note: We read from the OUTPUT of updateUsersWithGender which is 'users_profile_data.json'
const USERS_DATA_PATH = path.join(__dirname, "../data/auth/users_profile_data.json");
const PERF_OUTPUT_PATH = path.join(__dirname, "perf/user-profiles-perf.txt");
const TARGET_COUNT = 1000;

// --- Interfaces ---
interface UserData {
    userId: string;
    username: string;
    email: string;
    accessToken: string;
    name: string;
    gender: 'male' | 'female' | 'other' | 'prefer_not_to_say';
    birthDate: string; // From detect-gender.ts
}

interface CompleteProfilePayload {
    displayName: string;
    bio?: string;
    website?: string;
    location?: string;
    birthDate?: string;
    gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
}

// --- Data Pools ---
const BIOS = [
    "Lover of life, coffee, and code.",
    "Just another day in paradise.",
    "Digital nomad exploring the world.",
    "Tech enthusiast and foodie.",
    "Dream big, work hard.",
    "Creating memories one pixel at a time.",
    "Art, music, and good vibes.",
    "Always learning, always growing.",
    "Fitness junkie and health advocate.",
    "Capturing moments that last forever."
];

const LOCATIONS = [
    "New York, USA", "London, UK", "Tokyo, Japan", "Paris, France",
    "Berlin, Germany", "Sydney, Australia", "Toronto, Canada",
    "San Francisco, USA", "Singapore", "Dubai, UAE"
];

// --- Helpers ---
function getRandomElement<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Call the backend to complete the user profile
 */
async function completeProfile(payload: CompleteProfilePayload, accessToken: string) {
    // Ensure no double slash
    const cleanBaseUrl = baseUrl?.replace(/\/$/, "") || "";
    const url = `${cleanBaseUrl}/users/complete-profile`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
            },
            body: JSON.stringify(payload),
        });

        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const data = await res.json();
            if (!res.ok) {
                if (data.message === "Profile already completed") return data;
                throw new Error(JSON.stringify(data));
            }
            return data;
        } else {
            const text = await res.text();
            throw new Error(`Server returned non-JSON (${res.status}): ${text.substring(0, 200)}...`);
        }
    } catch (err: any) {
        throw err;
    }
}

export async function seedUserProfiles() {
    console.log("Starting User Profile Seeding...");

    // Ensure tokens are fresh and accounts are active
    await activateAndRefreshUsers(false);

    const startTime = performance.now();

    // 1. Load Users (from the generated profile data file)
    if (!fs.existsSync(USERS_DATA_PATH)) {
        throw new Error(`Users data not found at ${USERS_DATA_PATH}. Ensure updateUsersWithGender() ran successfully.`);
    }
    const users: UserData[] = JSON.parse(fs.readFileSync(USERS_DATA_PATH, "utf-8"));
    console.log(`Loaded ${users.length} users.`);

    // 2. Create Perf Directory
    const perfDir = path.dirname(PERF_OUTPUT_PATH);
    if (!fs.existsSync(perfDir)) {
        fs.mkdirSync(perfDir, { recursive: true });
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    // 3. Loop and Seed
    const countToProcess = Math.min(users.length, TARGET_COUNT);
    console.log(`Processing ${countToProcess} users...`);

    for (let i = 0; i < countToProcess; i++) {
        const user = users[i];

        if (!user.accessToken) {
            console.warn(`User ${user.userId} (${user.username}) has no access token. Skipping.`);
            skippedCount++;
            continue;
        }

        // Use data from file, falling back to defaults if missing
        // Ensure display_name is not empty
        const displayName = user.name && user.name.trim() !== "" ? user.name : user.username;
        // Fix birth_date format (YYYY-MM-DD -> ISO)
        let birthDateIso = user.birthDate ? new Date(user.birthDate).toISOString() : new Date(1990, 0, 1).toISOString();

        const payload: CompleteProfilePayload = {
            displayName: displayName || `User ${user.userId}`,
            bio: getRandomElement(BIOS),
            location: getRandomElement(LOCATIONS),
            gender: user.gender || 'prefer_not_to_say',
            birthDate: birthDateIso,
            website: `https://viora.app/u/${encodeURIComponent(user.username)}`
        };

        try {
            await completeProfile(payload, user.accessToken);
            successCount++;
            if ((i + 1) % 50 === 0) console.log(`Completed ${i + 1}/${countToProcess} profiles...`);
        } catch (err: any) {
            console.error(`Failed for user ${user.username}:`, err.message || err);
            console.error("Payload was:", JSON.stringify(payload));
            failCount++;
        }
    }

    // 4. Report
    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
User Profile Seeding Performance Report
---------------------------------------
Date: ${new Date().toISOString()}
Total Users Processed: ${countToProcess}
Success: ${successCount}
Failed: ${failCount}
Skipped: ${skippedCount}
Total Time: ${durationSec.toFixed(2)}s
Avg Time per User: ${(durationSec / (successCount + failCount || 1)).toFixed(4)}s
---------------------------------------
`;
    console.log(report);
    fs.writeFileSync(PERF_OUTPUT_PATH, report);
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
    seedUserProfiles().then(() => {
        // Cleanup resources
        import('../../src/config/pg.config.js').then(({ pool }) => pool.end());
        import('../../src/config/redis.config.js').then(({ default: redisClient }) => {
            if (redisClient.isOpen) redisClient.quit();
        });
        process.exit(0);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
