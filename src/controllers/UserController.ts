import userService from '../services/UserService.js';
import analyticsService from '../services/AnalyticsService.js';
import type { AuthenticatedRequest } from '@types';
import type { Request, Response } from 'express';
import { sDebug, sError, sInfo } from 'sk-logger';

class UserController {
  /**
   * Check username availability
   * GET /api/users/check-username?username=johndoe
   */
  async checkUsernameAvailability(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const username = req.query.username;
      const result = await userService.checkUsernameAvailability(username as string);

      return res.status(200).json({
        success: result.available,
        message: result.message
      });
    } catch (error) {
      sError('Error in checkUsernameAvailability:', error);
      return res.status(400).json({
        success: false,
        error: "Failed to check username availability"
      });
    }
  }

  /**
   * Update user profile picture
   * PUT /api/users/profile-picture
   */
  async updateUserProfilePicture(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const images = req.body.images!;
      const result = await userService.updateProfilePicture(userId, images);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in updateUserProfilePicture:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
  /**
   * Delete user profile picture
   * DELETE /api/users/profile-picture
   */
  async deleteUserProfilePicture(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const result = await userService.deleteProfilePicture(userId);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in deleteUserProfilePicture:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Update user profile
   * PUT /api/users/profile
   */
  async updateUserProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;
      const profileData = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const result = await userService.updateUserProfile(userId, profileData);

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in updateUserProfile:', error);
      return res.status(error.message === 'User profile not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Complete user profile (first-time setup)
   * POST /api/users/complete-profile
   */
  async completeUserProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const { displayName, bio, website, location, birthDate, gender } = req.body;

      const result = await userService.completeUserProfile(userId, {
        displayName,
        bio,
        website,
        location,
        birthDate,
        gender
      });

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in completeUserProfile:', error);
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get users with filters and pagination
   * GET /api/users?page=1&limit=20&search=john&verified=true&status=active
   */
  async getUsers(req: Request, res: Response): Promise<Response> {
    try {
      sDebug("Fetching users...");
      const filters = req.query;
      const result = await userService.getUsers(filters);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error: any) {
      sError('Error in getUsers:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get user by ID
   * GET /api/users/:userId
   */
  async getUserById(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { userId } = req.params;
      const requesterId = req.user?.userId;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }

      if (!requesterId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized'
        });
      }

      const user = await userService.getUserById(
        userId,
        requesterId
      );

      return res.status(200).json({
        success: true,
        data: user
      });
    } catch (error: any) {
      sError('Error in getUserById:', error);
      return res.status(error.message === 'User not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get current user profile
   * GET /api/users/me
   */
  async getMe(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const user = await userService.getMe(userId);

      return res.status(200).json({
        success: true,
        data: user
      });
    } catch (error: any) {
      sError('Error in getMe:', error);
      return res.status(error.message === 'User not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }
  /**
   * Get current user profile
   * GET /api/users/current
   */
  async getCurrentUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const user = await userService.getCurrentUser(userId);
      sDebug("User:", user);
      return res.status(200).json({
        success: true,
        data: user
      });
    } catch (error: any) {
      sError('Error in getCurrentUser:', error);
      return res.status(error.message === 'User not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get user by username
   * GET /api/users/username/:username
   */
  async getUserByUsername(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const username = req.params.username!;
      const requesterId = req.user?.userId;

      const user = await userService.getUserByUsername(username, requesterId || null);

      return res.status(200).json({
        success: true,
        data: user
      });
    } catch (error: any) {
      sError('Error in getUserByUsername:', error);
      return res.status(error.message === 'User not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Update user (admin or self)
   * PUT /api/users/:userId
   */
  async updateUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const requesterId = req.user?.userId;

      // Verify authorization
      if (requesterId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const profileData = req.body;
      const result = await userService.updateUserProfile(
        userId,
        profileData
      );

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in updateUser:', error);
      return res.status(error.message === 'User profile not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Delete/Deactivate user
   * DELETE /api/users/:userId
   */
  async deleteUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const requesterId = req.user?.userId;
      // const requesterRole = req.user.role;

      /*
      const result = await userService.deleteUser(
        parseInt(userId, 10),
        requesterId,
        requesterRole
      );

      return res.status(200).json({
        success: true,
        message: result.message
      });
      */
      return res.status(200).json({
        success: true,
        message: 'User deleted successfully'
      });
    } catch (error: any) {
      sError('Error in deleteUser:', error);

      const statusCode =
        error.message === 'Unauthorized to delete this user' ? 403 :
          error.message === 'User not found' ? 404 : 500;

      return res.status(statusCode).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Follow a user
   * POST /api/users/:userId/follow
   */
  async followUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const followerId = req.user?.userId!;
      const result = await userService.followUser(
        followerId,
        userId
      );

      return res.status(200).json({
        success: true,
        message: result.message,
        data: { status: result.status }
      });
    } catch (error: any) {
      sError('Error in followUser:', error);

      const statusCode =
        error.message === 'Cannot follow yourself' ? 400 :
          error.message === 'User not found' ? 404 : 500;

      return res.status(statusCode).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Unfollow a user
   * DELETE /api/users/:userId/follow
   */
  async unfollowUser(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const followerId = req.user?.userId!;
      const result = await userService.unfollowUser(
        followerId,
        userId
      );

      return res.status(200).json({
        success: true,
        message: result.message
      });
    } catch (error: any) {
      sError('Error in unfollowUser:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get user profile with follow status
   * GET /api/users/:userId/profile
   */
  async getUserProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const requesterId = req.user!.userId;
      sInfo('Getting user profile for user:', userId, requesterId);

      const profile = await userService.getUserProfile(userId, requesterId);
      // Simple Analytics: Track profile visit
      if (requesterId && requesterId !== userId) {
        analyticsService.trackProfileVisit(userId, requesterId);
      }

      return res.status(200).json({
        success: true,
        data: profile
      });
    } catch (error: any) {
      sError('Error in getUserProfile:', error);
      return res.status(error.message === 'User not found' ? 404 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get followers for a user
   * GET /api/users/:userId/followers?page=1&limit=20
   */
  async getFollowers(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const { page = 1, limit = 20 } = req.query;
      const followers = await userService.getFollowers(
        userId,
        parseInt(page as string, 10),
        parseInt(limit as string, 10)
      );

      return res.status(200).json({
        success: true,
        data: followers
      });
    } catch (error: any) {
      sError('Error in getFollowers:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get following for a user
   * GET /api/users/:userId/following?page=1&limit=20
   */
  async getFollowing(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.params.userId!;
      const { page = 1, limit = 20 } = req.query;
      const following = await userService.getFollowing(
        userId,
        parseInt(page as string, 10),
        parseInt(limit as string, 10)
      );

      return res.status(200).json({
        success: true,
        data: following
      });
    } catch (error: any) {
      sError('Error in getFollowing:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get current user activity log
   * GET /api/users/me/activity-log
   */
  async getActivityLog(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;
      const { page = 1, limit = 20, type } = req.query;

      const activity = await userService.getActivityLog(
        userId,
        parseInt(page as string, 10),
        parseInt(limit as string, 10),
        type as string
      );

      return res.status(200).json({
        success: true,
        data: activity
      });
    } catch (error: any) {
      sError('Error in getActivityLog:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

export default new UserController();