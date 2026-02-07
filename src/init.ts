import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
const dirs = [
  'public/images/thumbnails',
  'public/videos/thumbnails',
  'public/videos/previews',
  'public/videos/resolutions',
  'uploads/videos',
  'uploads/images/thumbnails',
  'uploads/chat-media/videos',
  'uploads/chat-media/images',
  'uploads/chat-media/audio'
];

dirs.forEach(dir => {
  const fullPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});
