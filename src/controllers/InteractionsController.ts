import { sError, sLog } from "sk-logger";
import intractionsService from "../services/InteractionsService.js";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "@types";
import redisClient from "@/config/redis.config.js";

class IntractionsController {

  async likeComment(req: AuthenticatedRequest, res: Response) {
    try {
      const { reactionType } = req.body
      const commentId = req.params.commentId!
      const userId = req.user?.userId!
      await intractionsService.likeComment(commentId, userId, reactionType)
      res.status(200).json({
        success: true,
        message: "Comment liked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async unlikeComment(req: AuthenticatedRequest, res: Response) {
    try {
      const commentId = req.params.commentId!
      const userId = req.user?.userId!
      await intractionsService.unlikeComment(commentId, userId)
      res.status(200).json({
        success: true,
        message: "Comment unliked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async likePost(req: AuthenticatedRequest, res: Response) {
    try {

      const postId = req.params.postId!
      const userId = req.user?.userId!
      await intractionsService.likePost(postId, userId)
      res.status(200).json({
        success: true,
        message: "Post liked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async unlikePost(req: AuthenticatedRequest, res: Response) {
    try {
      const postId = req.params.postId!
      const userId = req.user?.userId!
      await intractionsService.unlikePost(postId, userId)
      res.status(200).json({
        success: true,
        message: "Post unliked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }
  async likeReel(req: AuthenticatedRequest, res: Response) {
    try {
      const reelId = req.params.reelId!
      const userId = req.user?.userId!
      await intractionsService.likeReel(userId, reelId)
      res.status(200).json({
        success: true,
        message: "Reel liked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }
  async unlikeReel(req: AuthenticatedRequest, res: Response) {
    try {
      const reelId = req.params.reelId!
      const userId = req.user?.userId!
      await intractionsService.unlikeReel(userId, reelId)
      res.status(200).json({
        success: true,
        message: "Reel unliked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async likeStory(req: AuthenticatedRequest, res: Response) {
    try {
      const storyId = req.params.storyId!
      const userId = req.user?.userId!
      await intractionsService.likeStory(userId, storyId);
      res.status(200).json({
        success: true,
        message: "Story liked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async unlikeStory(req: AuthenticatedRequest, res: Response) {
    try {
      const storyId = req.params.storyId!
      const userId = req.user?.userId!
      await intractionsService.unlikeStory(userId, storyId);
      res.status(200).json({
        success: true,
        message: "Story unliked successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async sharePost(req: AuthenticatedRequest, res: Response) {
    try {
      const postId = req.params.postId!
      const userId = req.user?.userId!
      await intractionsService.sharePost(postId, userId)
      res.status(200).json({
        success: true,
        message: "Post shared successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async recordInterested(req: AuthenticatedRequest, res: Response) {
    try {
      const postId = req.params.postId!
      const userId = req.user?.userId!
      await intractionsService.recordPostInterest(postId, userId)
      res.status(200).json({
        success: true,
        message: "Recorded interest in post",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }

  async recordNotInterested(req: AuthenticatedRequest, res: Response) {
    try {
      const postId = req.params.postId!
      const userId = req.user?.userId!
      await intractionsService.recordPostDisinterest(postId, userId)
      res.status(200).json({
        success: true,
        message: "Recorded disinterest in post",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }
  async recordView(req: AuthenticatedRequest, res: Response) {
    try {
      const { targetId, durationMs, type } = req.body;
      const userId = req.user?.userId!;

      // Validate inputs
      if (!targetId || !type) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }

      await intractionsService.recordView(userId, targetId, type, durationMs || 0);

      res.status(200).json({
        success: true,
        message: "View recorded successfully",
      });
    } catch (error) {
      sError(error);
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: message });
    }
  }
}
const intractionsController = new IntractionsController();
export default intractionsController;