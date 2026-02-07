import feedService from "../services/FeedService.js";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "@types";
dotenv.config();

interface FeedQuery {
  page?: string;
  limit?: string;
  timeRange?: '1h' | '6h' | '12h' | '24h' | '7d' | '30d';
  hashtag?: string;
  sortBy?: 'trending' | 'recent' | 'popular';
  safeMode?: string;
  cursor?: string;
}

// Extend Express Request to include user if needed

class FeedController {
  static async getFeed(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { page = "1", limit = "10", safeMode, refresh } = req.query as unknown as FeedQuery & { refresh?: string };
      const userId = req.user?.userId!;

      const isRefresh = refresh === 'true';

      const result = await feedService.getFeed(Number(page), Number(limit), userId, safeMode ? Number(safeMode) : undefined, isRefresh);
      const posts = result.posts;

      return res.status(200).json({
        success: true,
        message: "Posts fetched successfully",
        data: posts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          hasMore: result.hasMore,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ success: false, error: message });
    }
  }

  static async getTrendingPosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { page = "1", limit = "10", timeRange, cursor } = req.query as unknown as FeedQuery;
      const userId = req.user!.userId;
      const result = await feedService.getTrendingPosts(
        Number(page),
        Number(limit),
        timeRange,
        userId,
        cursor
      );
      const posts = result.posts;

      return res.status(200).json({
        success: true,
        data: posts,
        message: "Trending posts fetched successfully",
        pagination: {
          page: Number(page),
          limit: Number(limit),
          hasMore: result.hasMore,
          nextCursor: result.nextCursor
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ success: false, error: message });
    }
  }

  static async getTrendingHashtags(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { limit = "10", timeRange } = req.query as unknown as FeedQuery;
      const userId = req.user!.userId;
      const result = await feedService.getTrendingHashtags(Number(limit), timeRange as any, userId);
      const hashtags = result.hashtags;

      return res.status(200).json({
        success: true,
        message: "Trending hashtags fetched successfully",
        data: hashtags.map((tag: any) => ({
          ...tag,
          samplePosts: tag.samplePosts || [],
        })),
        pagination: {
          limit: Number(limit),
          hasMore: result.hasMore,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({
        success: false,
        message: "Error in getTrendingHashtags",
        error: message,
      });
    }
  }

  static async getSuggestedPosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { page = "1", limit = "10", safeMode } = req.query as unknown as FeedQuery;
      const userId = req.user!.userId;
      const result = await feedService.getSuggestedPosts(Number(page), Number(limit), userId, safeMode ? Number(safeMode) : undefined);
      const posts = result.posts;

      return res.status(200).json({
        success: true,
        data: posts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          hasMore: result.hasMore,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ success: false, error: message });
    }
  }

  static async getPostsByHashtag(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { hashtag, page = "1", limit = "10", sortBy, cursor } = req.query as unknown as FeedQuery;
      const userId = req.user!.userId;
      if (!hashtag) {
        return res.status(400).json({ success: false, message: "Hashtag is required" });
      }
      const data = await feedService.getPostsByHashtag(
        hashtag,
        Number(page),
        Number(limit),
        sortBy,
        userId,
        cursor
      );

      return res.status(200).json({
        success: true,
        data: data.posts,
        message: "Posts fetched successfully",
        pagination: {
          page: Number(page),
          limit: Number(limit),
          hasMore: data.hasMore,
          nextCursor: data.nextCursor
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ success: false, message: message });
    }
  }
}

export default FeedController;
