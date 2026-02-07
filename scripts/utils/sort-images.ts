// Sort images from temp folder into male/female folders based on AI gender detection
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const EMBEDDING_SYS_URL = process.env.EMBEDDING_SYS_URL || 'http://localhost:8000';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        console.log(`  ✓ Detected: ${data.gender} (${Math.round(data.confidence * 100)}% confidence)`);
        return data.gender; // 'male' or 'female'
    } catch (error: any) {
        console.error(`  ✗ Detection failed: ${error.message}`);
        return null;
    }
}

async function main() {
    const TEMP_DIR = path.join(__dirname, '../assets/images/people/temp');
    const MALE_DIR = path.join(__dirname, '../assets/images/people/male');
    const FEMALE_DIR = path.join(__dirname, '../assets/images/people/female');

    // Ensure directories exist
    [MALE_DIR, FEMALE_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // Check if temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
        console.error(`❌ Temp directory not found: ${TEMP_DIR}`);
        process.exit(1);
    }

    // Get all image files from temp
    const imageFiles = fs.readdirSync(TEMP_DIR)
        .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
        .map(file => path.join(TEMP_DIR, file));

    if (imageFiles.length === 0) {
        console.log('ℹ️  No images found in temp folder.');
        return;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Sorting ${imageFiles.length} images from temp folder`);
    console.log(`Using AI gender detection service at ${EMBEDDING_SYS_URL}`);
    console.log(`${'='.repeat(60)}\n`);

    let maleCount = 0;
    let femaleCount = 0;
    let unknownCount = 0;

    for (let i = 0; i < imageFiles.length; i++) {
        const filePath = imageFiles[i];
        const fileName = path.basename(filePath);

        try {
            console.log(`[${i + 1}/${imageFiles.length}] Processing: ${fileName}`);

            const detectedGender = await detectGenderFromFile(filePath);

            if (detectedGender) {
                const targetDir = detectedGender === 'male' ? MALE_DIR : FEMALE_DIR;
                const newPath = path.join(targetDir, fileName);

                // Move file to appropriate folder
                fs.renameSync(filePath, newPath);

                if (detectedGender === 'male') {
                    maleCount++;
                    console.log(`  → Moved to male/`);
                } else {
                    femaleCount++;
                    console.log(`  → Moved to female/`);
                }
            } else {
                unknownCount++;
                console.log(`  ⚠ Detection failed, keeping in temp/`);
            }

            // Small delay to avoid overwhelming the API
            if (i < imageFiles.length - 1) {
                await sleep(100);
            }

        } catch (error: any) {
            console.error(`  ❌ Error processing ${fileName}: ${error.message}`);
            unknownCount++;
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`SORTING COMPLETE!`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total images processed: ${imageFiles.length}`);
    console.log(`✓ Male images: ${maleCount}`);
    console.log(`✓ Female images: ${femaleCount}`);
    console.log(`⚠ Unknown/Failed: ${unknownCount}`);
    console.log(`Success rate: ${Math.round((maleCount + femaleCount) / imageFiles.length * 100)}%`);
    console.log(`${'='.repeat(60)}\n`);

    if (unknownCount > 0) {
        console.log(`ℹ️  ${unknownCount} images remain in temp/ folder for manual review.`);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
