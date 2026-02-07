import path from 'path';
import fs from 'fs';
import mediaService from '../services/MediaService.js';
import type { AuthenticatedRequest } from '@types';
import type { Response } from 'express';
import { fileURLToPath } from 'url';
import ImageProcessor from '../media-processing/processors/ImageProcessor.js';
import multer from 'multer';
import { sDebug, sError, sInfo, sLog } from 'sk-logger';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadPath = path.join(__dirname, '../uploads');

class MediaController {
  /**
   * Initializes the media controller by creating the uploads directory if it does not exist.
   */
  constructor() {
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
  }

  /**
   * Upload image
   * POST /api/media/upload/image
   */
  async uploadImages(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const files: any = req.files;
      const { title, description } = req.body;
      const targetId = req.query.postId as string;
      const targetType = req.query.targetType as "POST" | "REEL" | "STORY" | "USER";
      const userId = req.user?.userId!;
      sDebug({ userId });
      const imagePaths = files.map((file: any) => path.relative(process.cwd(), file.path));
      if (!imagePaths) {
        return res.status(400).json({
          success: false,
          error: 'Image path is required'
        });
      }
      await mediaService.uploadAndProcessImages({
        userId: userId,
        targetId: targetId,
        targetType: targetType,
        title,
        description,
        images: imagePaths,
        videos: [],
        visibility: 'public',

      });
      return res.status(200).json({
        success: true,
        data: imagePaths,
        message: 'Image upload queued successfully'
      });
    } catch (error: any) {
      sError('Error in uploadImage:', error);
      return res.status(400).json({
        success: false,
        error: error.message || 'Failed to upload image'
      });
    }
  }

  /**
   * Upload video
   * POST /api/media/upload/video
   */
  async uploadVideo(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const files: any = req.files;
      const { title, description } = req.body;
      const targetId = req.query.postId as string;
      const targetType = req.query.targetType as "POST" | "REEL" | "STORY" | "USER";
      const userId = req.user?.userId!;
      sDebug({ userId });
      const videoPaths = files.map((file: any) => path.relative(process.cwd(), file.path));
      if (!videoPaths) {
        return res.status(400).json({
          success: false,
          error: 'Video path is required'
        });
      }
      await mediaService.uploadAndProcessVideos({
        userId: userId,
        targetId: targetId,
        targetType: targetType,
        title,
        description,
        videos: videoPaths,
        images: [],
        visibility: 'public',

      });
      return res.status(200).json({
        success: true,
        data: videoPaths,
        message: 'Video upload queued successfully'
      });
    } catch (error: any) {
      sError('Error in upload Video:', error);
      return res.status(400).json({
        success: false,
        error: error.message || 'Failed to upload video'
      });
    }
  }

  /**
   * Delete file
   * DELETE /api/media/:id
   */
  async deleteFile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const userId = req.user?.userId;
      // const result = await mediaService.deleteFile(parseInt(id, 10), userId);

      return res.status(200).json({
        success: true,
        //   message: result.message
      });
    } catch (error: any) {
      sError('Error in deleteFile:', error);

      const statusCode =
        error.message === 'File not found' ? 404 :
          error.message === 'Unauthorized to delete this file' ? 403 : 500;

      return res.status(statusCode).json({
        success: false,
        error: error.message || 'Error deleting file'
      });
    }
  }

  /**
   * Get media with pagination
   * GET /api/media?type=image&page=1&limit=10
   */
  async getMedia(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const type = (req.query.type as string) || 'image';
      const page = parseInt((req.query.page as string) || '1', 10);
      const limit = parseInt((req.query.limit as string) || '10', 10);
      const userId = req.user?.userId;

      // Validate pagination parameters
      if (isNaN(page) || page < 1) {
        return res.status(400).json({
          success: false,
          error: 'Invalid page number'
        });
      }

      if (isNaN(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          error: 'Invalid limit (must be between 1 and 100)'
        });
      }

      // Validate type
      if (!['image', 'video', 'all'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid type (must be image, video, or all)'
        });
      }

      //  const result = await mediaService.getMedia(userId, type, page, limit);

      return res.status(200).json({
        success: true,
        // data: result
      });
    } catch (error: any) {
      sError('Error in getMedia:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Database error'
      });
    }
  }
}

export default new MediaController();