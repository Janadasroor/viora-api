import postsService from '../services/PostsService.js';
import type { Request, Response } from 'express';
import type { UpdatePostParams, Visibility } from '@types';
import type { AuthenticatedRequest } from '@types';
import { sError } from 'sk-logger';
// Extend Express Request type to include user from auth middleware

interface GetPostsQuery {
  page?: number;
  limit?: number;
  cursor?: string;
  userId?: string;
  hashtag?: string;
  type?: string;
  sharedBy?: string;
  taggedUser?: string;
}

interface SavedPostsQuery {
  collectionId?: string;
  limit?: string;
  offset?: string;
}

interface CreatePostBody {
  caption?: string;
  postType?: 'photo' | 'video' | 'carousel';
  visibility?: Visibility;
  location?: string;
  hashtags?: string[];
  mediaFiles?: any[];
  status?: string;
}

type UpdatePostBody = UpdatePostParams;

class PostsController {
  /**
   * Get posts with optional filters
   * GET /api/posts
   */
  async getPosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const {
        page = 1,
        limit = 20,
        cursor,
        userId,
        hashtag,
        type,
        sharedBy,
        taggedUser
      } = req.query as unknown as GetPostsQuery;
      const requesterId = req.user?.userId!;
      const result = await postsService.getPosts({
        page,
        limit,
        cursor,
        userId,
        hashtag,
        type,
        requesterId,
        sharedBy,
        taggedUser
      });

      return res.status(200).json({
        success: true,
        data: result.posts,
        pagination: {
          page: page,
          limit: limit,
          count: result.posts.length,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError('Error in getPosts:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch posts',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mark posts as seen by the user
   * POST /api/posts/seen
   */
  async markPostsAsSeen(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const { postIds } = req.body;
      const userId = req.user?.userId!;

      if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Post IDs array is required'
        });
      }

      await postsService.markPostsAsSeen(userId, postIds);

      return res.status(200).json({
        success: true,
        message: 'Posts marked as seen'
      });
    } catch (error) {
      sError('Error in markPostsAsSeen:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to mark posts as seen',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get a single post by ID
   * GET /api/posts/:postId
   */
  async getPostById(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const requesterId = req.user?.userId!;
      const post = await postsService.getPostById(postId, requesterId);

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }

      return res.status(200).json({
        success: true,
        data: post
      });
    } catch (error) {
      sError('Error in getPostById:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Create a new post
   * POST /api/posts
   */
  async createPost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;

      const {
        caption = "",
        postType = 'photo',
        visibility = 'public',
        location = '',
        hashtags = [],
        mediaFiles = [],
        status
      } = req.body as CreatePostBody;
      const result = await postsService.createPost({
        userId,
        caption,
        postType,
        visibility,
        location,
        hashtags,
        mediaFiles,
        status: status || null
      });

      return res.status(201).json({
        success: true,
        message: 'Post created successfully',
        data: result
      });
    } catch (error) {
      sError('Error in createPost:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Update an existing post
   * PUT /api/posts/:postId
   */
  async updatePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;

      const { caption, location, visibility } = req.body as UpdatePostParams;
      await postsService.updatePost(postId, userId, {
        caption: caption || null,
        location: location || null,
        visibility: visibility || null
      });

      return res.status(200).json({
        success: true,
        message: 'Post updated successfully'
      });
    } catch (error) {
      sError('Error in updatePost:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'Post not found') {
        return res.status(404).json({
          success: false,
          error: errorMessage
        });
      }

      if (errorMessage.includes('Unauthorized')) {
        return res.status(403).json({
          success: false,
          error: errorMessage
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to update post',
        message: errorMessage
      });
    }
  }

  /**
   * Delete a post (soft delete)
   * DELETE /api/posts/:postId
   */
  async deletePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;
      const isAdmin = req.user?.role === 'admin';

      if (!postId) {
        return res.status(400).json({
          success: false,
          error: 'Post not found'
        });
      }
      await postsService.deletePost(postId, userId, isAdmin || false);

      return res.status(200).json({
        success: true,
        message: 'Post deleted successfully'
      });
    } catch (error) {
      sError('Error in deletePost:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'Post not found') {
        return res.status(404).json({
          success: false,
          error: errorMessage
        });
      }

      if (errorMessage.includes('Unauthorized')) {
        return res.status(403).json({
          success: false,
          error: errorMessage
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to delete post',
        message: errorMessage
      });
    }
  }

  /**
   * Get saved posts for the authenticated user
   * GET /api/posts/saved
   */
  async getSavedPosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const userId = req.user?.userId!;

      const {
        collectionId,
        limit = '20',
        offset = '0'
      } = req.query as SavedPostsQuery;
      const limitInt = parseInt(limit, 10);
      const offsetInt = parseInt(offset, 10);
      const posts = await postsService.getSavedPosts({
        userId,
        collectionId: collectionId ?? null,
        limit: limitInt,
        offset: offsetInt
      });

      return res.status(200).json({
        success: true,
        data: posts,
        pagination: {
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
          count: posts.length
        }
      });
    } catch (error) {
      sError('Error in getSavedPosts:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch saved posts',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Save a post to user's collection
   * POST /api/posts/:postId/save
   */
  async savePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;

      const collectionId = req.body.collectionId;

      await postsService.savePost(userId, postId, collectionId);

      return res.status(200).json({
        success: true,
        message: 'Post saved successfully'
      });
    } catch (error) {
      sError('Error in savePost:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to save post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Remove a post from user's saved collection
   * DELETE /api/posts/:postId/save
   */
  async unsavePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;

      await postsService.unsavePost(userId, postId);

      return res.status(200).json({
        success: true,
        message: 'Post unsaved successfully'
      });
    } catch (error) {
      sError('Error in unsavePost:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to unsave post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Remove a post from user's saved collection (Alias for unsavePost)
   * DELETE /api/posts/:postId/remove-saved
   */
  async removeSavedPost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    return this.unsavePost(req, res);
  }

  /**
   * Share a post
   * POST /api/posts/:postId/share
   */
  async sharePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;

      await postsService.sharePost(userId, postId);

      return res.status(200).json({
        success: true,
        message: 'Post shared successfully'
      });
    } catch (error) {
      sError('Error in sharePost:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to share post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Unshare a post
   * DELETE /api/posts/:postId/share
   */
  async unsharePost(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      const postId = req.params.postId!;
      const userId = req.user?.userId!;

      await postsService.unsharePost(userId, postId);

      return res.status(200).json({
        success: true,
        message: 'Post unshared successfully'
      });
    } catch (error) {
      sError('Error in unsharePost:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to unshare post',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export default new PostsController();