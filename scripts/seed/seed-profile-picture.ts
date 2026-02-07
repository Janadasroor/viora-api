
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { performance } from "perf_hooks";
import { uploadImages } from "./seed-media";
import { activateAndRefreshUsers } from "../setup/activate-and-refresh-users";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const USERS_DATA_PATH = path.join(__dirname, "../data/auth/users_profile_data.json");
const MALE_IMAGES_DIR = path.join(__dirname, "../assets/images/people/male");
const FEMALE_IMAGES_DIR = path.join(__dirname, "../assets/images/people/female");
const PERF_OUTPUT_PATH = path.join(__dirname, "perf/profile-picture-seed-perf.txt");
const TARGET_COUNT = 1000;

interface UserData {
    userId: string;
    username: string;
    gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
    accessToken?: string;
}

export async function seedProfilePictures() {
    console.log("Starting Profile Picture Seeding...");

    // Ensure tokens are fresh and accounts are active
    await activateAndRefreshUsers(false); // pass false to NOT close pool/redis yet

    const startTime = performance.now();

    // 1. Load Users
    if (!fs.existsSync(USERS_DATA_PATH)) {
        throw new Error(`Users data not found at ${USERS_DATA_PATH}`);
    }
    const users: UserData[] = JSON.parse(fs.readFileSync(USERS_DATA_PATH, "utf-8"));
    console.log(`Loaded ${users.length} users.`);

    // 2. Load Images
    const maleImages = fs.existsSync(MALE_IMAGES_DIR) ? fs.readdirSync(MALE_IMAGES_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f)) : [];
    const femaleImages = fs.existsSync(FEMALE_IMAGES_DIR) ? fs.readdirSync(FEMALE_IMAGES_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f)) : [];

    console.log(`Found ${maleImages.length} male images and ${femaleImages.length} female images.`);

    if (maleImages.length === 0 && femaleImages.length === 0) {
        console.warn("No images found in assets/images/people/male or female directories. Aborting.");
        return;
    }

    // 3. Create Perf Directory
    const perfDir = path.dirname(PERF_OUTPUT_PATH);
    if (!fs.existsSync(perfDir)) {
        fs.mkdirSync(perfDir, { recursive: true });
    }

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    const countToProcess = Math.min(users.length, TARGET_COUNT);
    console.log(`Processing ${countToProcess} users...`);

    for (let i = 0; i < countToProcess; i++) {
        const user = users[i];

        if (!user.accessToken) {
            skippedCount++;
            continue;
        }

        // Select Image
        let imageFile: string | undefined;
        let imageDir: string | undefined;

        if (user.gender === 'male' && maleImages.length > 0) {
            imageFile = maleImages[Math.floor(Math.random() * maleImages.length)];
            imageDir = MALE_IMAGES_DIR;
        } else if (user.gender === 'female' && femaleImages.length > 0) {
            imageFile = femaleImages[Math.floor(Math.random() * femaleImages.length)];
            imageDir = FEMALE_IMAGES_DIR;
        } else {
            // Fallback: Pick random from either if preferred unknown or other
            const allImages = [...maleImages, ...femaleImages];
            if (allImages.length > 0) {
                imageFile = allImages[Math.floor(Math.random() * allImages.length)];
                // Determine dir based on which list it came from? Or simpler: Just re-check headers? 
                // Actually safer to store full paths in array
                // Let's keep it simple: fallback to male if available, then female
                if (maleImages.length > 0) {
                    imageFile = maleImages[Math.floor(Math.random() * maleImages.length)];
                    imageDir = MALE_IMAGES_DIR;
                } else if (femaleImages.length > 0) {
                    imageFile = femaleImages[Math.floor(Math.random() * femaleImages.length)];
                    imageDir = FEMALE_IMAGES_DIR;
                }
            }
        }

        if (!imageFile || !imageDir) {
            console.warn(`No suitable image found for user ${user.username} (gender: ${user.gender})`);
            skippedCount++;
            continue;
        }

        const imagePath = path.join(imageDir, imageFile);
        const fileBuffer = fs.readFileSync(imagePath);

        // Mock File object for seed-media uploadImages which expects File[]
        // In Node, File is available in recent versions, or we might need a polyfill/Blob
        const file = new File([fileBuffer], imageFile, { type: 'image/jpeg' });

        try {
            await uploadImages({
                files: [file],
                targetType: 'USER',
                targetId: user.userId,
                accessToken: user.accessToken
            });
            successCount++;
            if ((i + 1) % 50 === 0) console.log(`Processed ${i + 1}/${countToProcess} profile pictures...`);
        } catch (err: any) {
            console.error(`Failed to upload for user ${user.username}:`, err.message || err);
            failCount++;
        }
    }

    // 4. Report
    const endTime = performance.now();
    const durationSec = (endTime - startTime) / 1000;

    const report = `
Profile Picture Seeding Performance Report
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
    seedProfilePictures().then(() => {
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