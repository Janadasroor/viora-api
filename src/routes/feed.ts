import { Router } from 'express';
import FeedController from '../controllers/FeedController.js';
import { validate } from '../middleware/validation.js';
import { feedSchemas } from '../validators/schemas/index.js';

const router = Router();

router.get('/posts/trending', validate(feedSchemas.getTrendingPostsSchema), FeedController.getTrendingPosts);
router.get('/posts/hashtag', validate(feedSchemas.getPostsByHashtagSchema), FeedController.getPostsByHashtag);
router.get('/trending/hashtags', validate(feedSchemas.getTrendingHashtagsSchema), FeedController.getTrendingHashtags);
router.get('/posts/suggested', validate(feedSchemas.getSuggestedPostsSchema), FeedController.getSuggestedPosts);
router.get('/posts', validate(feedSchemas.getFeedSchema), FeedController.getFeed);

export default router;