import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const METADATA_PATH = path.join(process.cwd(), 'scripts', 'seed', 'media_metadata.json');
const POSTS_DATA_PATH = path.join(process.cwd(), 'scripts', 'data', 'posts_data.json');
const OUTPUT_PATH = path.join(process.cwd(), 'scripts', 'seed', 'viora_seed_data.json');

async function generateSeedData() {
    console.log("Generating viora_seed_data.json...");

    if (!fs.existsSync(METADATA_PATH)) {
        console.error("Media metadata not found at:", METADATA_PATH);
        return;
    }

    if (!fs.existsSync(POSTS_DATA_PATH)) {
        console.error("Posts data not found at:", POSTS_DATA_PATH);
        return;
    }

    const mediaMetadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    const postsData = JSON.parse(fs.readFileSync(POSTS_DATA_PATH, 'utf-8'));

    const captions = postsData.captions;
    const locations = postsData.locations;

    const seedItems = mediaMetadata.map((item: any, index: number) => {
        // Cycle through captions and locations
        const caption = captions[index % captions.length];
        const location = locations[index % locations.length];

        return {
            path: item.path,
            category: item.query,
            caption: `${caption} #${item.query.replace(/\s+/g, '')}`,
            location: location
        };
    });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(seedItems, null, 2), 'utf-8');
    console.log(`Successfully generated ${seedItems.length} seed items at ${OUTPUT_PATH}`);
}

generateSeedData().catch(console.error);
