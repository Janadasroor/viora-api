
import type { Request, Response, NextFunction } from "express";

// controllers/ReelController.ts
import reelService from "../services/ReelService.js";
import type { AuthenticatedRequest } from "@types";
import { sError } from "sk-logger";

class ReelController {
  // ============================================
  // REEL FUNCTIONS
  // ============================================

  /**
   * Get all reels by a specific user
   */
  async getReelsByUser(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const userId = req.params.userId!;
      // Pass current user ID to check like status
      const currentUserId = req.user?.userId;
      const result = await reelService.getReelsByUser(userId, currentUserId);

      return res.status(200).json({
        success: true,
        message: "Reels fetched successfully",
        reels: result,
      });
    } catch (error) {
      sError("Error fetching reels by user:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to get reels by user",
      });
    }
  }

  /**
   * Get a single reel by ID
   */
  async getReelById(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const reelId = req.params.reelId!;
      // Pass current user ID to check like status
      const currentUserId = req.user?.userId;
      const result = await reelService.getReelById(reelId, currentUserId);

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Reel not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Reel fetched successfully",
        reel: result,
      });
    } catch (error) {
      sError("Error fetching reel by ID:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to get reel",
      });
    }
  }

  /**
   * Get personalized reel feed (trending + following)
   */
  async getReelFeed(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const cursor = req.query.cursor as string | undefined;
      const limit = parseInt(req.query.limit as string) || 12;
      const userId = req.user?.userId!;
      const result = await reelService.getReelFeed({ cursor, limit, userId });

      return res.status(200).json({
        success: true,
        message: "Reel feed fetched successfully",
        data: result.reels,
        pagination: {
          limit,
          count: result.reels.length,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError("Error fetching reel feed:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to get reel feed",
      });
    }
  }

  /**
   * Create a new reel
   */
  async createReel(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const { caption, audioUrl } = req.body;

      const insertResult = await reelService.createReel(
        userId,
        caption,
        audioUrl,
      );

      return res.status(201).json({
        success: true,
        message: "Reel created successfully",
        reel: insertResult,
      });
    } catch (error) {
      sError("Error creating reel:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to create reel",
      });
    }
  }

  /**
   * Delete a reel (only owner can delete)
   */
  async deleteReel(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const reelId = req.params.reelId;

      if (!userId || !reelId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized - user not authenticated",
        });
      }

      const result = await reelService.deleteReel(userId, reelId);

      if (!result) {
        return res.status(404).json({
          success: false,
          message: "Reel not found or unauthorized",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Reel deleted successfully",
      });
    } catch (error) {
      sError("Error deleting reel:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to delete reel",
      });
    }
  }

  /**
   * Modify reel caption (only owner can modify)
   */
  async modifyReel(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const reelId = req.params.reelId!;
      const { caption } = req.body;

      const updateResult = await reelService.modifyReel(
        userId,
        reelId,
        caption
      );

      if (!updateResult) {
        return res.status(404).json({
          success: false,
          message: "Reel not found or unauthorized",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Reel modified successfully",
        reel: updateResult,
      });
    } catch (error) {
      sError("Error modifying reel:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to modify reel",
      });
    }
  }

  /**
   * Increment view count for a reel
   */
  async incrementReelView(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      const reelId = req.params.reelId!;
      const userId = req.user!.userId; // Handle guest views with ID 0
      const { watchTime, duration } = req.body;
      await reelService.incrementReelView(reelId, userId, watchTime, duration);

      return res.status(200).json({
        success: true,
        message: "View count incremented successfully",
      });
    } catch (error) {
      sError("Error incrementing view:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to increment view count",
      });
    }
  }

  /**
   * Process all pending reel views
   */
  async processReelViews(
    req: AuthenticatedRequest,
    res: Response
  ): Promise<Response> {
    try {
      await reelService.processReelViews();

      return res.status(200).json({
        success: true,
        message: "Reel views processed successfully",
      });
    } catch (error) {
      sError("Error processing reel views:", error);
      return res.status(500).json({
        success: false,
        message: (error as Error).message || "Failed to process reel views",
      });
    }
  }
}

export default new ReelController();