import type { Request, Response } from 'express';
import storiesService from '../services/StoriesService.js';
import type { StoryData } from '@types';
// Extend Express Request type to include user from auth middleware
import type { AuthenticatedRequest } from '@types';
import { sError } from 'sk-logger';

interface PaginationQuery {
  page?: number;
  limit?: number;
  cursor?: string;
}



class StoriesController {
  async getStories(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const { cursor, limit = 20 } = req.query as unknown as PaginationQuery;
      const result = await storiesService.getUserStories({ cursor, limit: Number(limit), userId });

      return res.status(200).json({
        success: true,
        data: result.stories,
        pagination: {
          limit: Number(limit),
          count: result.stories.length,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError("Error in getStories:", error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("Page must be") || errorMessage.includes("Limit must be")) {
        return res.status(400).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }

  async getFollowingStories(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const { cursor, limit = 20 } = req.query as unknown as PaginationQuery;
      const result = await storiesService.getFollowingStories({ cursor, limit: Number(limit), userId });

      return res.status(200).json({
        success: true,
        data: result.stories,
        pagination: {
          limit: Number(limit),
          count: result.stories.length,
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError("Error in getFollowingStories:", error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("Page must be") || errorMessage.includes("Limit must be")) {
        return res.status(400).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }

  async getStoryViews(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const storyId = req.params.storyId!;
      const userId = req.user?.userId!;

      const { page = 1, limit = 20 } = req.query as PaginationQuery;

      const result = await storiesService.getStoryViewers(page, limit, userId, storyId);

      return res.status(200).json({
        success: true,
        data: result.views,
        pagination: {
          page: page,
          limit: limit,
          hasMore: result.hasMore
        }
      });
    } catch (error) {
      sError("Error in getStoryViews:", error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("Forbidden")) {
        return res.status(403).json({ success: false, message: errorMessage });
      }

      if (errorMessage.includes("not found")) {
        return res.status(404).json({ success: false, message: errorMessage });
      }

      if (errorMessage.includes("Page must be") || errorMessage.includes("Limit must be")) {
        return res.status(400).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }

  async createStory(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const storyData: StoryData = {
        storyType: req.body.storyType || "photo",
        content: req.body.content || null,
        backgroundColor: req.body.backgroundColor || null,
        textOverlay: req.body.textOverlay || null,
        stickers: req.body.stickers || null,
        musicId: req.body.musicId || null,
        visibility: req.body.visibility || "public",
        status: req.body.status || null
      };

      const result = await storiesService.createStory(userId, storyData);

      return res.status(201).json({
        success: true,
        data: result.story,
        message: result.message
      });
    } catch (error) {
      sError("Error in createStory:", error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("required") || errorMessage.includes("Invalid")) {
        return res.status(400).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }

  async deleteStory(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const storyId = req.params.storyId!;
      const result = await storiesService.deleteStory(userId, storyId);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error) {
      sError("Error in deleteStory:", error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("not found") || errorMessage.includes("permission")) {
        return res.status(404).json({ success: false, message: errorMessage });
      }

      if (errorMessage.includes("required")) {
        return res.status(400).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }

  async updateStory(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const storyId = req.params.storyId!;

      const updates: Partial<StoryData> = {
        visibility: req.body.visibility,
        textOverlay: req.body.textOverlay,
        stickers: req.body.stickers
      };

      // Remove undefined keys
      Object.keys(updates).forEach(key =>
        (updates as any)[key] === undefined && delete (updates as any)[key]
      );

      const result = await storiesService.updateStory(userId, storyId, updates);

      return res.status(200).json({
        success: true,
        data: result.story,
        message: result.message
      });
    } catch (error) {
      sError("Error in updateStory:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("not found") || errorMessage.includes("unauthorized")) {
        return res.status(404).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }
  async getStoryById(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const storyId = req.params.storyId!;

      const result = await storiesService.getStoryById(userId, storyId);

      return res.status(200).json({
        success: true,
        data: result.story,
        message: result.message
      });
    } catch (error) {
      sError("Error in getStoryById:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes("not found")) {
        return res.status(404).json({ success: false, message: errorMessage });
      }

      return res.status(500).json({ success: false, message: errorMessage });
    }
  }
}

export default new StoriesController();