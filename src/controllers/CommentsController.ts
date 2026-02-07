// src/controllers/CommentsController.ts
import type { Response } from "express";
import commentsService from "../services/CommentsService.js";
import type { AuthenticatedRequest } from "@types"; // your AuthRequest interface
import { sError } from "sk-logger";

class CommentsController {
  async getComments(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const targetId = req.params.targetId!;
      const { targetType, cursor, limit = "20" } = req.query;
      const userId = req.user!.userId;

      const normalizedTargetType = (targetType as string).toLowerCase();
      if (!["reel", "post", "comment"].includes(normalizedTargetType)) {
        return res.status(400).json({ success: false, message: "Invalid targetType" });
      }

      const result = await commentsService.getComments(
        cursor as string || null,
        parseInt(limit as string),
        targetId,
        normalizedTargetType as "reel" | "post" | "comment",
        userId
      );
      return res.status(200).json({
        success: true,
        data: result.comments,
        nextCursor: result.nextCursor
      });
    } catch (error: any) {
      sError("Error in getComments:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }


  async getCommentReplies(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const commentId = req.params.commentId!;
      const { cursor, limit = "20" } = req.query;
      const userId = req.user!.userId;
      const result = await commentsService.getCommentReplies(
        cursor as string || null,
        parseInt(limit as string),
        commentId,
        userId
      );

      return res.status(200).json({
        success: true,
        data: result.replies,
        nextCursor: result.nextCursor
      });
    } catch (error: any) {
      sError("Error in getCommentReplies:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async createComment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user!.userId;
      const { content, parentCommentId } = req.body as { content: string; parentCommentId?: string };

      const created = await commentsService.commentPost({ content, parentCommentId: parentCommentId || null, postId, userId });

      return res.status(201).json({
        success: true,
        message: "Comment created successfully",
        data: created
      });
    } catch (error: any) {
      sError("Error in createComment:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async updateComment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { commentId } = req.params;
      const userId = req.user!.userId;
      const { content } = req.body as { content: string };

      if (!commentId) {
        return res.status(400).json({ success: false, message: "Comment is not found" });
      }
      if (content.trim().length > 2000)
        return res.status(400).json({ success: false, message: "Comment content too long (max 2000 characters)" });

      const updated = await commentsService.updateComment({ commentId, userId, content });

      return res.status(200).json({ success: true, message: "Comment updated successfully", updated });
    } catch (error: any) {
      sError("Error in updateComment:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteComment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const commentId = req.params.commentId!;
      const userId = req.user!.userId;

      const deleted = await commentsService.deleteComment({ commentId, userId });

      return res.status(200).json({ success: true, message: "Deleted", data: deleted });
    } catch (error: any) {
      sError("Error in deleteComment:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async commentReel(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user!.userId;
      const reelId = req.params.reelId!;
      const { content, parentCommentId } = req.body as { content: string; parentCommentId?: string };

      const insertResult = await commentsService.commentReel(userId, reelId, content, parentCommentId || null);

      return res.status(201).json({
        success: true,
        message: "Comment added successfully",
        data: insertResult
      });
    } catch (error: any) {
      sError("Error commenting on reel:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to add comment" });
    }
  }

  async updateReelComment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user!.userId;
      const commentId = req.params.commentId!;
      const { content } = req.body as { content: string };
      const updated = await commentsService.updateComment({ commentId, userId, content });

      return res.status(200).json({ success: true, message: "Comment updated successfully", updated });
    } catch (error: any) {
      sError("Error in updateComment:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  async deleteReelComment(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user!.userId;
      const commentId = req.params.commentId!;
      //const isAdmin =false  // req.user?.role === "admin"; 
      const deleted = await commentsService.deleteComment({ commentId, userId });

      return res.status(200).json({
        success: true,
        message: "Comment deleted successfully",
        data: deleted
      });
    } catch (error: any) {
      sError("Error deleting comment:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to delete comment" });
    }
  }
}

export default new CommentsController();
