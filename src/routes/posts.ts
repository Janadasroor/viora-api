import { Router } from 'express';
import postsController from "../controllers/PostsController.js";
import { validate } from '../middleware/validation.js';
import { postSchemas } from '../validators/schemas/index.js';

const router = Router();

// Post routes without the /posts prefix
router.get('/', validate(postSchemas.getPostsSchema), postsController.getPosts);
router.get('/by/:postId', validate(postSchemas.getPostByIdSchema), postsController.getPostById);
router.post('/', validate(postSchemas.createPostSchema), postsController.createPost);
router.put('/:postId', validate(postSchemas.updatePostSchema), postsController.updatePost);
router.delete('/:postId', validate(postSchemas.deletePostSchema), postsController.deletePost);
router.get('/saved', validate(postSchemas.getSavedPostsSchema), postsController.getSavedPosts);
router.post('/:postId/save', validate(postSchemas.savePostSchema), postsController.savePost);
router.delete('/:postId/save', validate(postSchemas.unsavePostSchema), postsController.unsavePost);
router.delete('/:postId/remove-saved', validate(postSchemas.removeSavedPostSchema), postsController.removeSavedPost);

router.post('/:postId/share', postsController.sharePost);
router.delete('/:postId/share', postsController.unsharePost);

export default router;
