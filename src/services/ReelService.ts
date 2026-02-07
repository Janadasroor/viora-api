// services/ReelService.ts
import reelRepository from "../repositories/ReelRepository.js";
import redisService from "../cache/RedisService.js";
import reelViewsQueue from "../jobs/queues/reelViewsQueue.js";
import type { MediaDeleteRequest, ReelWithUser } from "@types";
import { sDebug, sError } from "sk-logger";
import mediaCleanUpQueue from "@/jobs/queues/mediaCleanupQueue.js";

class ReelService {
  /**
   * Get all reels by a specific user
   */
  async getReelsByUser(userId: string, currentUserId?: string): Promise<ReelWithUser[]> {
    try {
      const reels = await reelRepository.getReelsByUser(userId, currentUserId);
      return reels;
    } catch (error) {
      sError("Error getting reels by user:", error);
      throw new Error("Error getting reels by user");
    }
  }

  /**
   * Get a single reel by ID
   */
  async getReelById(reelId: string, currentUserId?: string): Promise<ReelWithUser | null> {
    try {
      const reel = await reelRepository.getReelById(reelId, currentUserId);
      return reel;
    } catch (error) {
      sError("Error getting reel by ID:", error);
      throw error; // Rethrow the original error to see the stack trace and message
    }
  }

  /**
   * Get personalized reel feed
   */
  async getReelFeed(
    { cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }
  ): Promise<{ reels: ReelWithUser[], nextCursor?: string }> {
    try {
      return await reelRepository.getReelFeed({ cursor, limit, userId });
    } catch (error) {
      sError("Error getting reel feed:", error);
      throw new Error("Error getting reel feed");
    }
  }

  /**
   * Create a new reel
   */
  async createReel(
    userId: string,
    caption: string,

    audioUrl: string | null = null,
  ): Promise<ReelWithUser> {
    try {
      const reel = await reelRepository.createReel(
        userId,
        caption,
        audioUrl,
      );
      return reel;
    } catch (error) {
      sError("Error creating reel:", error);
      throw new Error("Error creating reel");
    }
  }

  /**
   * Delete a reel
   */
  async deleteReel(userId: string, reelId: string): Promise<boolean> {
    try {

      mediaCleanUpQueue.addCleanUp({
        userId: userId,
        targetId: reelId,
        targetType: 'REEL'
      } as MediaDeleteRequest);
      return true;
    } catch (error) {
      sError("Error deleting reel:", error);
      throw new Error("Error deleting reel");
    }
  }

  /**
   * Modify reel caption
   */
  async modifyReel(
    userId: string,
    reelId: string,
    caption: string
  ): Promise<ReelWithUser> {
    try {
      const reel = await reelRepository.modifyReel(userId, reelId, caption);
      return reel;
    } catch (error) {
      sError("Error modifying reel:", error);
      throw new Error("Error modifying reel");
    }
  }

  /**
   * Increment view count for a reel
   */
  async incrementReelView(
    reelId: string,
    userId: string,
    watchTime?: number,
    duration?: number
  ): Promise<void> {
    try {
      const shouldProcessNow = await redisService.incrementReelView(
        reelId,
        userId,
        watchTime,
        duration
      );
      if (shouldProcessNow) {
        sDebug(`Incrementing view count for reel ${reelId}`);
        await reelViewsQueue.addBatchJob(reelId);
      }
    } catch (error) {
      sError("Error incrementing reel view count:", error);
      throw new Error("Error incrementing reel view count");
    }
  }

  /**
   * Process all pending reel views
   */
  async processReelViews(): Promise<void> {
    try {
      // Implementation would go here
      // This might involve processing queued views from Redis
      sDebug("Processing reel views...");
    } catch (error) {
      sError("Error processing reel views:", error);
      throw new Error("Error processing reel views");
    }
  }
}

// Uncomment this line to process views every 10 seconds
// setInterval(() => new ReelService().processReelViews(), 10000);

export default new ReelService();