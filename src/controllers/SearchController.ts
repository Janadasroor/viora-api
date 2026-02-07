import type { Request, Response } from 'express';
import searchService from '../services/SearchService.js';
import type { SuggestionType } from '@types';
import type { AuthenticatedRequest } from '@types';
import { sDebug, sError } from 'sk-logger';

interface SearchQuery {
  query?: string;
  cursor?: string;
  limit?: number;
  sortBy?: 'relevance' | 'recent' | 'popular';
  type?: SuggestionType;
}

class SearchController {
  /**
   * Search Posts - Main search endpoint for posts
   */
  async searchPosts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    try {
      sDebug("Post Search Endpoint");
      const {
        query: searchQuery,
        cursor = null,
        limit = 20,
        sortBy = 'relevance' // relevance, recent, popular
      } = req.query as any;
      const userId = req.user?.userId!;

      const result = await searchService.searchPosts(searchQuery!, cursor, limit, sortBy, userId);

      return res.status(200).json({
        success: true,
        data: result.posts,
        nextCursor: result.nextCursor,
        message: 'Search results',
        query: searchQuery,
        sortBy,
        pagination: {
          limit: limit,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError('Error in searchPosts:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Search Users - Search for user accounts
   */
  async searchUsers(req: AuthenticatedRequest, res: Response): Promise<Response> {
    sDebug("Users Search Endpoint");

    try {
      const {
        query: searchQuery,
        cursor = null,
        limit = 20
      } = req.query as any;
      const userId = req.user?.userId || null; // Get from auth middleware
      sDebug(userId);

      const result = await searchService.searchUsers(searchQuery!, cursor, limit, userId);
      return res.status(200).json({
        success: true,
        data: result.users,
        nextCursor: result.nextCursor,
        query: searchQuery,
        message: 'Search results',
        pagination: {
          limit: limit,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError('Error in searchUsers:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Search Hashtags - Search for hashtags
   */
  async searchHashtags(req: Request, res: Response): Promise<Response> {
    try {
      sDebug("Hashtags Search Endpoint");

      const {
        query: searchQuery,
        cursor = null,
        limit = 20
      } = req.query as any;

      const result = await searchService.searchHashtags(searchQuery!, cursor, limit);

      // Remove relevanceScore from response
      result.hashtags.forEach((tag: any) => {
        delete tag.relevanceScore;
      });

      return res.status(200).json({
        success: true,
        data: result.hashtags,
        nextCursor: result.nextCursor,
        query: searchQuery,
        message: 'Search results',
        pagination: {
          limit: limit,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError('Error in searchHashtags:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Search Locations - Search for locations
   */
  async searchLocations(req: Request, res: Response): Promise<Response> {
    try {
      sDebug("Locations Search Endpoint");
      const {
        query: searchQuery,
        cursor = null,
        limit = 20
      } = req.query as any;

      const result = await searchService.searchLocations(searchQuery!, cursor, limit);

      return res.status(200).json({
        success: true,
        data: result.locations,
        nextCursor: result.nextCursor,
        query: searchQuery,
        message: 'Search results',
        pagination: {
          limit: limit,
          nextCursor: result.nextCursor
        }
      });
    } catch (error) {
      sError('Error in searchLocations:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Unified Search - Search across all types (posts, users, hashtags, locations)
   */
  async unifiedSearch(req: AuthenticatedRequest, res: Response): Promise<Response> {
    sDebug("Unified Search Endpoint");
    try {
      const { query: searchQuery } = req.query as SearchQuery;
      const userId = req.user?.userId || null;
      const topLimit = 5;

      const unifiedSearchResults = await searchService.unifiedSearch(searchQuery!, userId, topLimit);
      return res.status(200).json({
        success: true,
        query: searchQuery,
        message: 'Search results',
        data: unifiedSearchResults
      });
    } catch (error) {
      sError('Error in unifiedSearch:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get Search Suggestions - For autocomplete
   */
  async getSearchSuggestions(req: Request, res: Response): Promise<Response> {
    try {
      const { query: searchQuery, type = 'all' } = req.query as SearchQuery;

      const suggestions = await searchService.getSearchSuggestions(searchQuery!, type);

      return res.status(200).json({
        success: true,
        message: 'Search suggestions',
        data: suggestions
      });
    } catch (error) {
      sError('Error in getSearchSuggestions:', error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export default new SearchController();