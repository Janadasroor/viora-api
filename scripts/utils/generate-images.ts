//Generate REAL photorealistic face images for free using This Person Does Not Exist
//No API key required, completely free, generates unique faces every time
import fs, { writeFile } from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const EMBEDDING_SYS_URL = process.env.EMBEDDING_SYS_URL || 'http://localhost:8000';

//Save buffer to file
function saveBinaryFile(fileName: string, content: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        writeFile(fileName, content, (err) => {
            if (err) {
                console.error(`Error writing file ${fileName}:`, err);
                reject(err);
                return;
            }
            console.log(`File ${fileName} saved to file system.`);
            resolve();
        });
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate using This Person Does Not Exist (always returns unique photorealistic faces)
async function generateFace(): Promise<Buffer> {
    const url = `https://thispersondoesnotexist.com/?${Date.now()}`; // Add timestamp to prevent caching

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache"
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// Detect gender using Python service
async function detectGenderFromFile(filePath: string): Promise<string | null> {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const form = new FormData();
        form.append('file', fileBuffer, { filename: path.basename(filePath), contentType: 'image/jpeg' });

        const response = await fetch(`${EMBEDDING_SYS_URL}/detect-gender`, {
            method: 'POST',
            body: form
        });

        if (!response.ok) {
            console.error(`  Detection API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json() as { gender: string, confidence: number };
        return data.gender; // 'male' or 'female'
    } catch (error: any) {
        console.error(`  Detection failed: ${error.message}`);
        return null;
    }
}

async function main() {
    const promptsFilePath = path.join(__dirname, '../data/ai/prompts.json');
    let data = JSON.parse((fs.readFileSync(promptsFilePath)).toString());

    console.log(`Total prompts loaded: ${data.length}`);

    const MAX_IMAGES = 1000;
    const TEMP_DIR = path.join(__dirname, '../assets/images/people/temp');
    const MALE_DIR = path.join(__dirname, '../assets/images/people/male');
    const FEMALE_DIR = path.join(__dirname, '../assets/images/people/female');

    // Ensure directories exist
    [TEMP_DIR, MALE_DIR, FEMALE_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`PHASE 1: Downloading ${MAX_IMAGES} photorealistic faces`);
    console.log(`Using: This Person Does Not Exist (Free, No API Key)`);
    console.log(`Quality: 1024x1024 photorealistic faces`);
    console.log(`${'='.repeat(60)}\n`);

    const downloadedFiles: string[] = [];
    let successCount = 0;
    let failedCount = 0;

    // PHASE 1: Download all images to temp folder
    while (successCount < MAX_IMAGES && data.length > 0) {
        const sourceData = data[successCount % data.length];
        const prompt = sourceData.prompt;

        try {
            console.log(`\nDownloading image ${successCount + 1}/${MAX_IMAGES}...`);

            let buffer: Buffer | null = null;
            let retries = 0;
            const MAX_RETRIES = 3;

            // Retry logic for network issues
            while (!buffer && retries < MAX_RETRIES) {
                try {
                    buffer = await generateFace();
                } catch (error: any) {
                    retries++;
                    if (retries < MAX_RETRIES) {
                        console.log(`  Retry ${retries}/${MAX_RETRIES} after error: ${error.message}`);
                        await sleep(2000);
                    } else {
                        throw error;
                    }
                }
            }

            if (!buffer) {
                throw new Error('Failed to generate image after retries');
            }

            // Save to temp folder with simple naming
            const fileName = `face_${Date.now()}_${successCount}.jpeg`;
            const filePath = path.join(TEMP_DIR, fileName);
            await saveBinaryFile(filePath, buffer);
            downloadedFiles.push(filePath);

            successCount++;
            console.log(`✓ Downloaded (${successCount}/${MAX_IMAGES})`);

            // Delay between requests to be respectful (1.5 seconds)
            await sleep(1500);

        } catch (error: any) {
            failedCount++;
            console.error(`❌ Error: ${error.message}`);
            console.log(`  Failed count: ${failedCount}`);

            // If too many failures in a row, wait longer
            if (failedCount > 5) {
                console.log(`  Multiple failures detected, waiting 10 seconds...`);
                await sleep(10000);
                failedCount = 0; // Reset counter
            } else {
                await sleep(3000);
            }
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`PHASE 1 COMPLETE: Downloaded ${downloadedFiles.length} images`);
    console.log(`${'='.repeat(60)}\n`);

    // PHASE 2: Batch process gender detection and sort
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PHASE 2: Detecting gender and sorting images`);
    console.log(`${'='.repeat(60)}\n`);

    let maleCount = 0;
    let femaleCount = 0;
    let unknownCount = 0;

    for (let i = 0; i < downloadedFiles.length; i++) {
        const filePath = downloadedFiles[i];
        const fileName = path.basename(filePath);

        try {
            console.log(`Processing ${i + 1}/${downloadedFiles.length}: ${fileName}`);

            const detectedGender = await detectGenderFromFile(filePath);

            if (detectedGender) {
                const targetDir = detectedGender === 'male' ? MALE_DIR : FEMALE_DIR;
                const newPath = path.join(targetDir, fileName);

                // Move file to appropriate folder
                fs.renameSync(filePath, newPath);

                if (detectedGender === 'male') {
                    maleCount++;
                    console.log(`  ✓ Male (confidence: high) → moved to male/`);
                } else {
                    femaleCount++;
                    console.log(`  ✓ Female (confidence: high) → moved to female/`);
                }
            } else {
                unknownCount++;
                console.log(`  ⚠ Detection failed, keeping in temp/`);
            }

            // Small delay to avoid overwhelming the API
            await sleep(100);

        } catch (error: any) {
            console.error(`  ❌ Error processing ${fileName}: ${error.message}`);
            unknownCount++;
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`PROCESSING COMPLETE!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total images downloaded: ${downloadedFiles.length}`);
    console.log(`Male images: ${maleCount}`);
    console.log(`Female images: ${femaleCount}`);
    console.log(`Unknown/Failed: ${unknownCount}`);
    console.log(`Download success rate: ${Math.round(successCount / (successCount + failedCount) * 100)}%`);
    console.log(`Detection success rate: ${Math.round((maleCount + femaleCount) / downloadedFiles.length * 100)}%`);
    console.log(`${'='.repeat(60)}`);
}

main();