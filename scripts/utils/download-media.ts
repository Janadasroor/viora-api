import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const QUERIES_PATH = path.join(process.cwd(), 'scripts', 'data', 'search', 'search_queries.json');
const METADATA_PATH = path.join(process.cwd(), 'scripts', 'seed', 'media_metadata.json');
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'seed_media');

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

// Load queries from JSON
const QUERIES: string[] = JSON.parse(fs.readFileSync(QUERIES_PATH, 'utf-8'));

const TOTAL_TARGET = 1200;
const IMAGES_PER_QUERY = Math.ceil(TOTAL_TARGET / QUERIES.length); // ~12 images per query

async function downloadImage(url: string, filepath: string) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  return new Promise((resolve, reject) => {
    response.data.pipe(fs.createWriteStream(filepath))
      .on('error', reject)
      .on('finish', () => resolve(filepath));
  });
}

async function fetchFromPexels(query: string, perPage: number) {
  if (!PEXELS_API_KEY) {
    throw new Error('PEXELS_API_KEY is not defined in .env');
  }

  try {
    const response = await axios.get(`https://api.pexels.com/v1/search`, {
      params: {
        query,
        per_page: perPage,
        orientation: 'portrait' // Better for vertical-style feeds
      },
      headers: {
        Authorization: PEXELS_API_KEY
      }
    });

    return response.data.photos.map((p: any) => p.src.large2x || p.src.large);
  } catch (error) {
    console.error(`Error fetching from Pexels for query "${query}":`, (error as any).message);
    return [];
  }
}

async function startSeeding() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let mediaList: any[] = fs.existsSync(METADATA_PATH) ? JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8')) : [];

  console.log(`Starting download for ${QUERIES.length} categories, target: ${TOTAL_TARGET} images.`);

  for (const query of QUERIES) {
    const existingForQuery = mediaList.filter((m: any) => m.query === query);
    const needed = IMAGES_PER_QUERY - existingForQuery.length;

    if (needed <= 0) {
      console.log(`Category "${query}" already has ${existingForQuery.length} images. Skipping.`);
      continue;
    }

    console.log(`Downloading ${needed} images for: "${query}" from Pexels`);

    // Fetch real URLs from Pexels
    const imageUrls = await fetchFromPexels(query, needed);

    for (let i = 0; i < needed; i++) {
      const imageUrl = imageUrls[i];
      if (!imageUrl) {
        console.log(`  No more images for "${query}" at index ${i}`);
        break;
      }

      // Safe filename: remove non-alphanumeric
      const safeQuery = query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const index = existingForQuery.length + i;
      const filename = `${safeQuery}_${index}.jpg`;
      const filepath = path.join(OUTPUT_DIR, filename);

      try {
        await downloadImage(imageUrl, filepath);
        mediaList.push({ path: filename, query: query });

        if ((i + 1) % 5 === 0 || i === needed - 1) {
          console.log(`  Progress: ${index + 1}/${IMAGES_PER_QUERY}`);
          fs.writeFileSync(METADATA_PATH, JSON.stringify(mediaList, null, 2));
        }

        // Small delay to be polite to Pexels and disk
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`  Failed to download ${filename}:`, (error as Error).message);
      }
    }
  }

  console.log('Seeding metadata finalized at scripts/seed/media_metadata.json');
  console.log(`Total images downloaded: ${mediaList.length}`);
}

startSeeding().catch(console.error);
