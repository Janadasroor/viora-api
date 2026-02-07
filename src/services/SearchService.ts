import type {
  SortBy, SuggestionType
} from '@types';
import searchRepository from '../repositories/SearchRepository.js';
import { sDebug, sError, sWarn } from 'sk-logger';

class SearchService {
  async unifiedSearch(searchQuery: string, userId: string | null = null, topLimit = 5) {
    const startTime = Date.now();
    try {
      sDebug(`[SearchService] unifiedSearch called with query: "${searchQuery}", userId: ${userId}, topLimit: ${topLimit}`);

      const results = await searchRepository.unifiedSearch(searchQuery, userId, topLimit);

      const duration = Date.now() - startTime;
      if (duration > 200) {
        sWarn(`[SearchService] SLOW unifiedSearch: ${duration}ms for query "${searchQuery}"`);
      }

      sDebug(`[SearchService] unifiedSearch results:`, {
        postsCount: results.posts?.length || 0,
        usersCount: results.users?.length || 0,
        hashtagsCount: results.hashtags?.length || 0,
        locationsCount: results.locations?.length || 0,
        duration: `${duration}ms`
      });

      return results;
    } catch (error) {
      sError('[SearchService] unifiedSearch error:', error);
      throw new Error("Error in unifiedSearch");
    }
  }

  async searchPosts(searchQuery: string, cursor: string | null = null, limit: number, sortBy: SortBy = 'relevance', userId: string | null = null) {
    const startTime = Date.now();
    try {
      sDebug(`[SearchService] searchPosts called with query: "${searchQuery}", cursor: ${cursor}, limit: ${limit}, sortBy: ${sortBy}, userId: ${userId}`);
      const posts = await searchRepository.searchPosts(searchQuery, cursor, limit, sortBy, userId);

      const duration = Date.now() - startTime;
      if (duration > 200) {
        sWarn(`[SearchService] SLOW searchPosts: ${duration}ms for query "${searchQuery}"`);
      }

      return posts;
    } catch (error) {
      sError(error);
      throw new Error("Error in searchPosts");
    }
  }

  async searchUsers(searchQuery: string, cursor: string | null = null, limit: number, userId: string | null = null) {
    const startTime = Date.now();
    try {
      const users = await searchRepository.searchUsers(searchQuery, cursor, limit, userId);

      const duration = Date.now() - startTime;
      if (duration > 200) {
        sWarn(`[SearchService] SLOW searchUsers: ${duration}ms for query "${searchQuery}"`);
      }

      return users;
    } catch (error) {
      sError(error);
      throw new Error("Error in searchUsers");
    }
  }

  async searchHashtags(searchQuery: string, cursor: string | null = null, limit: number) {
    try {
      return await searchRepository.searchHashtags(searchQuery, cursor, limit);
    } catch (error) {
      sError(error);
      throw new Error("Error in searchHashtags");
    }
  }

  async searchLocations(searchQuery: string, cursor: string | null = null, limit: number) {
    try {
      return await searchRepository.searchLocations(searchQuery, cursor, limit);
    } catch (error) {
      sError(error);
      throw new Error("Error in searchLocations");
    }
  }
  async getSearchSuggestions(searchQuery: string, type: SuggestionType = 'all', suggestionLimit = 5) {
    try {
      return await searchRepository.getSearchSuggestions(searchQuery, type);
    } catch (error) {
      sError(error);
      throw new Error("Error in getSearchSuggestions");
    }
  }
}

export default new SearchService();
