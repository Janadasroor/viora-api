// routes/searchRoutes.ts

import { Router } from 'express';
import searchController from '../controllers/SearchController.js';
import { validate } from '../middleware/validation.js';
import { searchSchemas } from '../validators/schemas/index.js';

const router = Router();

/**
 * @route   GET /api/search/posts
 * @desc    Search posts with filtering and sorting
 * @access  Public (with optional auth for personalized results)
 * @params  query, page, limit, sortBy (relevance|recent|popular)
 */
router.get('/posts', validate(searchSchemas.searchPostsSchema), searchController.searchPosts);

/**
 * @route   GET /api/search/users
 * @desc    Search user accounts
 * @access  Public (with optional auth for follow status)
 * @params  query, page, limit
 */
router.get('/users', validate(searchSchemas.searchUsersSchema), searchController.searchUsers);

/**
 * @route   GET /api/search/hashtags
 * @desc    Search hashtags
 * @access  Public
 * @params  query, page, limit
 */
router.get('/hashtags', validate(searchSchemas.searchHashtagsSchema), searchController.searchHashtags);

/**
 * @route   GET /api/search/locations
 * @desc    Search locations
 * @access  Public
 * @params  query, page, limit
 */
router.get('/locations', validate(searchSchemas.searchLocationsSchema), searchController.searchLocations);

/**
 * @route   GET /api/search
 * @desc    Unified search across all types
 * @access  Public (with optional auth)
 * @params  query
 */
router.get('/', validate(searchSchemas.unifiedSearchSchema), searchController.unifiedSearch);

/**
 * @route   GET /api/search/suggestions
 * @desc    Get autocomplete suggestions
 * @access  Public
 * @params  query, type (all|users|hashtags|locations)
 */
router.get('/suggestions', validate(searchSchemas.searchSuggestionsSchema), searchController.getSearchSuggestions);

export default router;