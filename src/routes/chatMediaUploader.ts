import express from "express";
import type { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import type { StorageEngine, FileFilterCallback } from "multer";
import path from "path";
import fs from "fs";
import { getCurrentHost } from "../utils/formatLink.js";
import { sDebug } from "sk-logger";

const router: Router = express.Router();

// Create uploads folder structure
const uploadDirs = {
  images: "./uploads/chat-media/images",
  videos: "./uploads/chat-media/videos",
  audio: "./uploads/chat-media/audio"
} as const;

Object.values(uploadDirs).forEach((dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage with dynamic destination
const storage: StorageEngine = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    let targetDir: string = uploadDirs.images;

    if (file.mimetype.startsWith("video/")) {
      targetDir = uploadDirs.videos;
    } else if (file.mimetype.startsWith("audio/")) {
      targetDir = uploadDirs.audio;
    }

    cb(null, targetDir || uploadDirs.images);
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname);
    const timestamp = Date.now();
    const randomId = Math.round(Math.random() * 1E9);
    const uniqueName = `${timestamp}-${randomId}${ext}`;
    cb(null, uniqueName);
  }
});

// File type configurations
interface MediaTypeConfig {
  mimeTypes: string[];
  maxSize: number;
  folder: string;
}

const mediaConfig = {
  image: {
    mimeTypes: ["image/jpeg", "image/png", "image/jpg", "image/gif", "image/webp"],
    maxSize: 5 * 1024 * 1024, // 5MB
    folder: "images"
  },
  video: {
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"],
    maxSize: 50 * 1024 * 1024, // 50MB
    folder: "videos"
  },
  audio: {
    mimeTypes: ["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg"],
    maxSize: 10 * 1024 * 1024, // 10MB
    folder: "audio"
  }
} as const;

// Create upload middleware factory
const createUploadMiddleware = (mediaType: string): multer.Multer => {
  const config = mediaConfig[mediaType as keyof typeof mediaConfig];
  if (!config) throw new Error("Invalid media type");

  return multer({
    storage,
    limits: { fileSize: config.maxSize },
    fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
      if ((config.mimeTypes as readonly string[]).includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type. Allowed types: ${config.mimeTypes.join(", ")}`));
      }
    }
  });
};

// Upload middlewares
const uploadImage = createUploadMiddleware("image");
const uploadVideo = createUploadMiddleware("video");
const uploadAudio = createUploadMiddleware("audio");

// Helper function to build media URL
const buildMediaUrl = (req: Request, folder: string, filename: string): string => {
  const host = req.get("host");
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}/uploads/chat-media/${folder}/${filename}`;
};

// Helper function to get file metadata
interface FileMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

const getFileMetadata = (file: Express.Multer.File): FileMetadata => {
  return {
    filename: file.filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date().toISOString()
  };
};

// POST /upload-image
router.post("/upload-image", uploadImage.single("image"), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded"
      });
    }

    const imageUrl = buildMediaUrl(req, "images", req.file.filename);
    const metadata = getFileMetadata(req.file);
    sDebug(metadata);
    res.json({
      success: true,
      url: imageUrl,
      metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error uploading image",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// POST /upload-video
router.post("/upload-video", uploadVideo.single("video"), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No video uploaded"
      });
    }

    const videoUrl = buildMediaUrl(req, "videos", req.file.filename);
    const metadata = getFileMetadata(req.file);

    res.json({
      success: true,
      url: videoUrl,
      metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error uploading video",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// POST /upload-audio (for voice recordings)
router.post("/upload-audio", uploadAudio.single("audio"), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No audio uploaded"
      });
    }

    const audioUrl = buildMediaUrl(req, "audio", req.file.filename);
    const metadata = getFileMetadata(req.file);

    res.json({
      success: true,
      url: audioUrl,
      metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error uploading audio",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// POST /upload-media (generic endpoint for any media type)
router.post("/upload-media", (req: Request, res: Response, next: NextFunction) => {
  const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
      const allAllowedTypes = [
        ...mediaConfig.image.mimeTypes,
        ...mediaConfig.video.mimeTypes,
        ...mediaConfig.audio.mimeTypes
      ];

      if ((allAllowedTypes as string[]).includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type"));
      }
    }
  }).single("media");

  upload(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No media uploaded"
      });
    }

    try {
      let folder = "images";
      if (req.file.mimetype.startsWith("video/")) folder = "videos";
      if (req.file.mimetype.startsWith("audio/")) folder = "audio";

      const mediaUrl = buildMediaUrl(req, folder, req.file.filename);
      const metadata = getFileMetadata(req.file);

      res.json({
        success: true,
        url: mediaUrl,
        type: folder.slice(0, -1), // Remove 's' from folder name
        metadata
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error processing media",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
});

// DELETE /delete-media/:type/:filename
router.delete("/delete-media/:type/:filename", (req: Request, res: Response) => {
  try {
    const { type, filename } = req.params;
    if (!type || !filename) {
      return res.status(400).json({ success: false, message: "Type and filename are required" });
    }

    if (!["images", "videos", "audio"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid media type"
      });
    }

    const directory = uploadDirs[type as keyof typeof uploadDirs];
    if (!directory) {
      return res.status(400).json({ success: false, message: "Invalid media type" });
    }
    const filePath = path.join(directory, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: "Media deleted successfully"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting media",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Error handling middleware
router.use((error: any, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large"
      });
    }
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  res.status(500).json({
    success: false,
    message: error.message || "Unknown error occurred"
  });
});

export default router;