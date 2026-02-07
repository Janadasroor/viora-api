import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
// --- Types ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bucket = any;

interface FirebaseConfig {
  projectId?: string;
  storageBucket?: string;
  emulatorHost?: string;
  bucket?: Bucket;
}

interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  saveFilesLocally?: boolean;
  moveFromPath?: string;
}

interface PresignedUrlOptions {
  contentType?: string;
  expiresIn?: number;
}

interface UploadResult {
  url: string;
  key: string;
}

const publicDir = path.join(process.cwd(), 'public');

// --- StorageService Class ---

class StorageService {
  private client: Bucket | null = null;
  private isFirebaseEnabled: boolean = false;
  private baseUrl: string;

  constructor(config: FirebaseConfig) {
    // Determine if we are using Firebase based on if a bucket is provided or if environment says so
    // Ideally we pass `isFirebaseEnabled` in config, but we can infer:
    // If config.bucket is null and USE_FIREBASE is false, we are in local mode.

    // We'll rely on the availability of the bucket to determine mode
    if (config.bucket) {
      this.client = config.bucket;
      this.isFirebaseEnabled = true;
    } else if (process.env.USE_FIREBASE === 'true') {
      this.client = this._initialize(config);
      this.isFirebaseEnabled = true;
    } else {
      this.client = null; // Local mode
      this.isFirebaseEnabled = false;
    }

    // Base URL for local files (static files are served at the root)
    this.baseUrl = (process.env.BASE_URL || 'http://localhost:3003/api/1.0.0/').replace('/api/1.0.0/', '/');
    if (!this.baseUrl.endsWith('/')) this.baseUrl += '/';
  }

  private _initialize(config: FirebaseConfig): Bucket {
    if (config.bucket) {
      return config.bucket;
    }

    if (!config.projectId || !config.storageBucket) {
      // If no config provided but we are trying to init, throw error ONLY if we really meant to use Firebase
      throw new Error('Firebase projectId and storageBucket must be provided for Firebase mode');
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: config.projectId,
        storageBucket: config.storageBucket
      });

      if (config.emulatorHost) {
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = config.emulatorHost;
      }
    }

    return admin.storage().bucket();
  }

  /**
   * Upload a file
   * @param file - File to upload (Buffer or Uint8Array)
   * @param dir - Storage path (e.g., 'users/123/avatar.jpg')
   * @param options - Additional options (contentType, metadata)
   * @returns Upload result with URL and key
   */
  async upload(
    file: Buffer | Uint8Array,
    dir: string,
    options: UploadOptions = { saveFilesLocally: true }
  ): Promise<UploadResult> {

    // 1. Firebase Upload (if enabled)
    if (this.isFirebaseEnabled && this.client) {
      const fileRef = this.client.file(dir);
      const metadata = {
        contentType: options.contentType || 'application/octet-stream',
        metadata: options.metadata || {}
      };
      try {
        await fileRef.save(file, {
          metadata,
          resumable: false
        });
      } catch (e) {
        console.error("Firebase upload failed", e);
        throw e;
      }
    }

    // 2. Local Storage (Fallback or Primary)
    // Always save locally if requested OR if Firebase is disabled (must save somewhere)
    // Note: If Firebase is disabled, we force local save effectively.
    if (options.saveFilesLocally || !this.isFirebaseEnabled) {
      const filePath = path.join(publicDir, dir);
      const folder = path.dirname(filePath);
      await fs.promises.mkdir(folder, { recursive: true });

      if (options.moveFromPath) {
        // MOVE operation - no copying needed!
        // Check if source exists
        if (fs.existsSync(options.moveFromPath)) {
          await fs.promises.rename(options.moveFromPath, filePath);
        }
      } else {
        // COPY operation - for backward compatibility
        await fs.promises.writeFile(filePath, file);
      }
    } else if (options.moveFromPath) {
      // Not saving locally and Firebase enabled -> delete source
      if (fs.existsSync(options.moveFromPath)) {
        //  await fs.promises.unlink(options.moveFromPath);
      }
    }

    const url = await this.getUrl(dir);
    return { url, key: dir };
  }

  /**
     * More efficient: Upload directly from file path
     * Moves file to public dir after successful upload
     */
  async uploadFromPath(
    sourcePath: string,
    destDir: string,
    options: Omit<UploadOptions, 'moveFromPath'> = { saveFilesLocally: true }
  ): Promise<UploadResult> {
    // Delegate to upload() but let it handle the move
    // Reading file into buffer defeats purpose of stream/path upload optimization but for simplicity/unification:
    // Ideally we stream to Firebase.

    // 1. Firebase Stream Upload (if enabled)
    if (this.isFirebaseEnabled && this.client) {
      const fileRef = this.client.file(destDir);
      const metadata = {
        contentType: options.contentType || 'application/octet-stream',
        metadata: options.metadata || {}
      };
      await this.client.upload(sourcePath, {
        destination: destDir,
        metadata: metadata,
        resumable: false
      });
    }

    // 2. Handle Local File
    if (options.saveFilesLocally || !this.isFirebaseEnabled) {
      const destPath = path.join(publicDir, destDir);
      const folder = path.dirname(destPath);
      await fs.promises.mkdir(folder, { recursive: true });

      // COPY the file
      await fs.promises.copyFile(sourcePath, destPath);
    } else {
      // Delete source if not keeping
      //  await fs.promises.unlink(sourcePath);
    }

    const url = await this.getUrl(destDir);
    return { url, key: destDir };
  }

  /**
   * Get a file's public URL
   * @param path - Storage path
   * @returns File URL
   */
  async getUrl(path: string): Promise<string> {

    // If not Firebase, return local static URL
    if (!this.isFirebaseEnabled || !this.client) {
      return `${this.baseUrl}${path}`;
    }

    const file = this.client.file(path);

    // Check if using emulator
    if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
      const [host, port] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
      return `http://${host}:${port}/v0/b/${this.client.name}/o/${encodeURIComponent(path)}?alt=media`;
    }

    // Production: Generate signed URL (valid for 1 hour)
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 3600 * 1000
    });

    return url;
  }

  /**
   * Generate a presigned upload URL (client-side uploads)
   * @param path - Storage path
   * @param options - Upload options
   * @returns Presigned URL
   */
  async getPresignedUploadUrl(path: string, options: PresignedUrlOptions = {}): Promise<string> {
    if (!this.isFirebaseEnabled || !this.client) {
      throw new Error("Presigned URLs not supported with local storage");
    }

    const file = this.client.file(path);
    const [url] = await file.getSignedUrl({
      action: 'write',
      expires: Date.now() + (options.expiresIn || 3600) * 1000,
      contentType: options.contentType || 'application/octet-stream'
    });
    return url;
  }

  /**
   * Delete a file
   * @param filePath - Storage path
   */
  async delete(filePath: string, deleteLocally?: boolean): Promise<void> {
    if (!filePath) return;

    if (this.isFirebaseEnabled && this.client) {
      try {
        const file = this.client.file(filePath);
        await file.delete();
      } catch (e) {
        console.warn(`Firebase delete failed for ${filePath}`, e);
      }
    }

    // Always attempt to delete locally if the file exists in publicDir
    // This ensures cleanup of local backups or when running in local-only mode
    const fp = path.join(publicDir, filePath);
    if (fs.existsSync(fp)) {
      try {
        fs.unlinkSync(fp);
      } catch (e) {
        console.warn(`Local delete failed for ${fp}`, e);
      }
    }
  }
}

// --- Factory Function ---

export function createFirebaseStorage(config: FirebaseConfig): StorageService {
  return new StorageService(config);
}

// --- Usage Examples ---

/*
// 1. Using existing Firebase Admin bucket (recommended for your setup)
import { bucket } from './firebase-config.js'; // your existing config

const storage = createFirebaseStorage({
  bucket: bucket // Pass your existing bucket instance
});

// OR initialize new instance with emulator

const storage = createFirebaseStorage({
  projectId: 'bobb-185c9',
  storageBucket: 'bobb-185c9.appspot.com',
  emulatorHost: 'localhost:9199'
});

// 2. Upload a file
import { readFileSync } from 'fs';
const fileBuffer = readFileSync('./photo.jpg');

const result = await storage.upload(fileBuffer, `users/${userId}/avatar.jpg`, {
  contentType: 'image/jpeg',
  metadata: { userId: '123', uploadedAt: new Date().toISOString() }
});

// 3. Get file URL
const url = await storage.getUrl('users/123/avatar.jpg');

// 4. Delete file
await storage.delete('users/123/avatar.jpg');

// 5. Presigned URL for client-side upload
const uploadUrl = await storage.getPresignedUploadUrl('users/123/photo.jpg', {
  contentType: 'image/jpeg',
  expiresIn: 3600
});
*/

export { StorageService };
export type {
  UploadOptions,
  PresignedUrlOptions,
  UploadResult,
  FirebaseConfig
};