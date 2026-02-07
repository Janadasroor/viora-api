import { sError } from "sk-logger";
import storiesRepository from "../repositories/StoriesRepository.js";
import redisService from "../cache/RedisService.js";
import type { PaginatedStories, Story, PaginatedViews, StoryView, StoryData, MediaDeleteRequest } from "@types";
import mediaCleanUpQueue from "@/jobs/queues/mediaCleanupQueue.js";

class StoriesService {

  async getUserStories({ cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }): Promise<PaginatedStories> {
    try {
      const validatedLimit = Math.min(100, Math.max(1, limit || 12));
      return await storiesRepository.getStories({ cursor, limit: validatedLimit, userId });
    } catch (error) {
      sError("Error in getUserStories service:", error);
      throw error;
    }
  }

  async getFollowingStories({ cursor, limit, userId }: { cursor?: string | undefined, limit: number, userId: string }): Promise<PaginatedStories> {
    try {
      const validatedLimit = Math.min(100, Math.max(1, limit || 12));
      return await storiesRepository.getFollowingStories({ cursor, limit: validatedLimit, userId });
    } catch (error) {
      sError("Error in getFollowingStories service:", error);
      throw error;
    }
  }

  async getStoryViewers(page: number, limit: number, userId: string, storyId: string) {
    try {
      // Validate pagination parameters
      const validatedPage = page || 1;
      const validatedLimit = limit || 10;

      if (validatedPage < 1) {
        throw new Error("Page must be greater than 0");
      }

      if (validatedLimit < 1 || validatedLimit > 100) {
        throw new Error("Limit must be between 1 and 100");
      }

      if (!storyId) {
        throw new Error("Story ID is required");
      }

      return await storiesRepository.getStoryViews(validatedPage, validatedLimit, userId, storyId);
    } catch (error) {
      sError("Error in getStoryViewers service:", error);
      throw error;
    }
  }

  async createStory(userId: string, storyData: StoryData) {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      if (!storyData) {
        throw new Error("Story data is required");
      }



      const validStoryTypes = ["photo", "video", "text"];
      if (storyData.storyType && !validStoryTypes.includes(storyData.storyType)) {
        throw new Error(`Invalid storyType. Must be one of: ${validStoryTypes.join(", ")}`);
      }

      const validVisibilities = ["public", "friends", "private"];
      if (storyData.visibility && !validVisibilities.includes(storyData.visibility)) {
        throw new Error(`Invalid visibility. Must be one of: ${validVisibilities.join(", ")}`);
      }

      // Set initial status: use explicit status from frontend if provided,
      // otherwise fallback to auto-detection (published for text stories, processing for others)
      if (!storyData.status) {
        storyData.status = storyData.storyType === 'text' ? 'published' : 'processing';
      }

      const story = await storiesRepository.createStory(userId, storyData);

      return {
        story,
        message: "Story created successfully"
      };
    } catch (error) {
      sError("Error in createStory service:", error);
      throw error;
    }
  }

  async deleteStory(userId: string, storyId: string) {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      if (!storyId) {
        throw new Error("Story ID is required");
      }
      mediaCleanUpQueue.addCleanUp({
        userId: userId,
        targetId: storyId,
        targetType: 'STORY'
      } as MediaDeleteRequest);

      return {
        success: true,
        message: "Story deleted successfully"
      };
    } catch (error) {
      sError("Error in deleteStory service:", error);
      throw error;
    }
  }

  async updateStory(userId: string, storyId: string, updates: Partial<StoryData>) {
    try {
      if (!userId) throw new Error("User ID is required");
      if (!storyId) throw new Error("Story ID is required");
      if (!updates || Object.keys(updates).length === 0) throw new Error("No updates provided");

      const validVisibilities = ["public", "friends", "private"];
      if (updates.visibility && !validVisibilities.includes(updates.visibility)) {
        throw new Error(`Invalid visibility. Must be one of: ${validVisibilities.join(", ")}`);
      }

      const story = await storiesRepository.updateStory(userId, storyId, updates);

      return {
        story,
        message: "Story updated successfully"
      };
    } catch (error) {
      sError("Error in updateStory service:", error);
      throw error;
    }
  }

  async getStoryById(userId: string, storyId: string) {
    try {
      if (!userId) throw new Error("User ID is required");
      if (!storyId) throw new Error("Story ID is required");

      const story = await storiesRepository.getStoryById(storyId, userId);

      if (!story) {
        throw new Error("Story not found");
      }

      return {
        story,
        message: "Story fetched successfully"
      };
    } catch (error) {
      sError("Error in getStoryById service:", error);
      throw error;
    }
  }

  async incrementStoryView(userId: string, storyId: string) {
    try {
      if (!userId || !storyId) {
        throw new Error("User ID and Story ID are required");
      }

      // Add to Redis buffer
      await redisService.addToViewBuffer(storyId, userId);

      // Track that this story has pending views
      await redisService.trackPendingViews(storyId);

      return { success: true };
    } catch (error) {
      sError("Error in incrementStoryView service:", error);
      throw error;
    }
  }
}

export default new StoriesService();