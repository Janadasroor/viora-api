import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer, { type Multer, type StorageEngine } from 'multer';
import type { Request, Response } from 'express';
import { checkFileType } from '../validators/validators.js';
import { StorageError } from './errors.js';
import { pool } from '../config/pg.config.js';
import { formatLink } from './formatLink.js';
import type { FileType } from '@types';
import { sDebug, sError } from 'sk-logger';
// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadFolder = path.join(__dirname, '../uploads');

// Ensure upload folder exists
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Configure multer storage
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload: Multer = multer({ storage });

/**
 * Upload a file using multer
 * 
 * @param req - Express request object
 * @param type - File field name
 * @returns Uploaded file object
 * @throws StorageError if upload fails or no file provided
 */
export async function uploadFile(
  req: Request,
  type: FileType
): Promise<Express.Multer.File> {
  return new Promise((resolve, reject) => {
    const singleUpload = upload.single(type);

    singleUpload(req, null as any, (err) => {
      if (err) return reject(err);
      if (!req.file) return reject(new StorageError('No file uploaded'));

      sDebug(req.file.size);

      // Check file type
      if (!checkFileType(req.file.mimetype, type)) {
        return reject(new StorageError('Invalid file type'));
      }

      resolve(req.file);
    });
  });
}

/**
 * Move a file from one location to another
 * 
 * @param oldPath - Current file path
 * @param newPath - Target file path
 */
export async function moveFile(oldPath: string, newPath: string): Promise<void> {
  const folder = path.dirname(newPath);
  await fs.promises.mkdir(folder, { recursive: true });
  sDebug(oldPath);
  await fs.promises.rename(oldPath, newPath);
}

/**
 * Delete a file from the filesystem
 * 
 * @param filePath - Path to the file to delete
 */
export async function deleteFile(filePath: string): Promise<void> {
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
}

/**
 * Generate a file URL based on filename and type
 * 
 * @param filename - Name of the file
 * @param type - Type of file (image, video, etc.)
 * @returns URL path to the file
 */
export function getFileURL(filename: string, type: string): string {
  return `/${type}s/${filename}`; // e.g., /images/xxx.png
}

interface MediaMetadata {
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  thumbnail_path?: string | null;
}

/**
 * Save file metadata to the database
 * 
 * @param file - Multer file object
 * @param filePath - Path where file is stored
 * @param userId - ID of the user uploading the file
 * @param res - Express response object
 */
export async function setMetadata(
  file: Express.Multer.File,
  filePath: string,
  userId: string,
  res: Response
): Promise<void> {
  const file_name = file.filename;
  const original_name = file.originalname;
  const file_size = file.size;
  let media_type = file.mimetype;

  // Determine media type category
  if (media_type.startsWith("image/")) media_type = "image";
  else if (media_type.startsWith("video/")) media_type = "video";
  else if (media_type.startsWith("audio/")) media_type = "audio";
  else media_type = "other";

  // Optional: extract width, height, duration for images/videos
  const metadata: MediaMetadata = {
    width: null,
    height: null,
    duration_seconds: null,
    thumbnail_path: null
  };

  // TODO: Implement logic to extract width, height, duration, thumbnail_path for enhanced media metadata management.

  const sql = `
    INSERT INTO media_files
    (user_id, file_name, file_path, file_size, mime_type, media_type, width, height, duration_seconds, thumbnail_path, storage_provider, is_processed, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING media_id
  `;

  try {
    const result = await pool.query<{ media_id: string }>(sql, [
      userId,
      file_name,
      filePath,
      file_size,
      file.mimetype,
      media_type,
      metadata.width,
      metadata.height,
      metadata.duration_seconds,
      metadata.thumbnail_path,
      'local',      // storage_provider default
      false,        // is_processed default (boolean)
      null          // metadata JSON (can add extra info here)
    ]);

    if (result.rows.length === 0 || result.rows[0] === undefined) {
      throw new Error('Failed to insert media metadata');
    }

    const mediaId = result.rows[0].media_id;

    res.json({
      success: true,
      message: 'Uploaded',
      mediaId,
      file_name,
      file_url: formatLink(file_name)
    });

    sDebug('Metadata saved:', {
      file_name,
      original_name,
      file_size,
      filePath,
      media_type,
      file_url: formatLink(file_name),
      mediaId
    });
  } catch (err) {
    sError('Error in setMetadata:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
}

/**
 * Delete a file record from the database
 * 
 * @param id - Media file ID (UUID)
 * @param res - Express response object
 */
export async function deleteFileFromDB(
  id: string,
  res: Response
): Promise<void> {
  try {
    const result = await pool.query(
      'DELETE FROM media_files WHERE media_id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }

    res.json({ success: true, message: 'Deleted', mediaId: id });
  } catch (err) {
    sError('Error in deleteFileFromDB:', err);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
}